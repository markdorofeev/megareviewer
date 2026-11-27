import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  PASS_ANSWER_FORMAT,
  PassAnswer,
  passAnswerFormat,
  TOUR_PASS_ANSWER_FORMAT,
  toStrictJsonSchema,
} from "./output-schema.ts";

/** Every object schema inside `schema`, at any depth. */
const objects = (schema: unknown): Record<string, unknown>[] => {
  if (Array.isArray(schema)) return schema.flatMap(objects);
  if (typeof schema !== "object" || schema === null) return [];
  return [Object.fromEntries(Object.entries(schema)), ...Object.values(schema).flatMap(objects)];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

describe("the answer format", () => {
  const { schema } = PASS_ANSWER_FORMAT;
  const json = JSON.stringify(schema);

  it("is a union of the two passes, one variant each", () => {
    expect(json.match(/"const":"\w+"/g)).toEqual(['"const":"intent"', '"const":"findings"']);
    expect(json).not.toContain("oneOf");
  });

  it("keeps the enums, so the model can't answer outside them", () => {
    expect(json).toContain('"enum":["minor","major","blocking"]');
    expect(json).toContain('"enum":["unrequested","missing","contradicts"]');
  });

  it("asks the intent for its summary and behavior changes", () => {
    const [intent] = objects(schema).filter(
      (node) => isObject(node.properties) && "behaviorChanges" in node.properties,
    );
    expect(intent?.required).toEqual(["summary", "behaviorChanges"]);
  });

  it("asks each finding for the guidance that shaped it, or null", () => {
    const marked = objects(schema).filter(
      (node) => isObject(node.properties) && "guidance" in node.properties,
    );
    expect(marked.map((node) => Object.keys(node.properties ?? {})[0])).toEqual(["title"]);
    for (const node of marked) {
      expect(node.required).toContain("guidance");
      expect(isObject(node.properties) ? node.properties.guidance : null).toEqual({
        anyOf: [
          {
            type: "object",
            properties: {
              ref: { type: "string" },
              effect: { type: "string", enum: ["raised", "left-out"] },
            },
            required: ["ref", "effect"],
            additionalProperties: false,
          },
          { type: "null" },
        ],
      });
    }
  });

  it("parses an answer with marks, and one from before there were any as null", () => {
    const finding = {
      title: "Serves another tenant's receipt",
      explanation: "The query has no tenant filter.",
      lines: { hunkId: "h_0123456789abcdef", side: "new", startLine: 4, line: 4 },
      type: "contract",
      severity: "blocking",
      suggestion: null,
      mismatch: null,
    };
    const answer = (findings: unknown[]) =>
      PassAnswer.parse({ answer: { pass: "findings", findings } });
    expect(answer([{ ...finding, guidance: { ref: "p1", effect: "raised" } }, finding])).toEqual({
      answer: {
        pass: "findings",
        findings: [
          { ...finding, guidance: { ref: "p1", effect: "raised" } },
          { ...finding, guidance: null },
        ],
      },
    });
    expect(
      PassAnswer.safeParse({
        answer: {
          pass: "findings",
          findings: [{ ...finding, guidance: { ref: "REVIEW.md", effect: "raised" } }],
        },
      }).success,
    ).toBe(false);
  });

  it("asks for a finding's type, and reads one from before there were any as logic", () => {
    const findings = objects(schema).filter(
      (node) => isObject(node.properties) && "severity" in node.properties,
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const node of findings) {
      expect(isObject(node.properties) && node.properties.type).toEqual({
        type: "string",
        enum: ["logic", "contract", "architecture"],
      });
      expect(node.required).toContain("type");
    }
    const parsed = PassAnswer.parse({
      answer: {
        pass: "findings",
        findings: [
          {
            title: "Skips the first page",
            explanation: "",
            lines: { hunkId: "h_0123456789abcdef", side: "new", startLine: 4, line: 4 },
          },
        ],
      },
    });
    expect(parsed.answer.pass === "findings" && parsed.answer.findings[0]?.type).toBe("logic");
  });

  it("closes every object and drops keywords structured outputs don't support", () => {
    for (const node of objects(schema).filter((candidate) => candidate.type === "object")) {
      expect(node.additionalProperties).toBe(false);
    }
    for (const keyword of ["pattern", "minLength", "readOnly", "$schema", "$ref", "$defs"]) {
      expect(json).not.toContain(`"${keyword}"`);
    }
  });
});

describe("toStrictJsonSchema", () => {
  it("keeps descriptions and nullable types", () => {
    const schema = z.object({ ref: z.string().nullable().describe("A ticket key") });
    expect(toStrictJsonSchema(schema)).toEqual({
      type: "object",
      properties: { ref: { type: ["string", "null"], description: "A ticket key" } },
      required: ["ref"],
      additionalProperties: false,
    });
  });
});

describe("the answer format of a run with the tour", () => {
  const json = JSON.stringify(TOUR_PASS_ANSWER_FORMAT.schema);

  it("adds the steps pass's variant after the two, which it leaves as they were", () => {
    expect(json.match(/"const":"\w+"/g)).toEqual([
      '"const":"intent"',
      '"const":"findings"',
      '"const":"steps"',
    ]);
    const variants = (schema: unknown): unknown[] => {
      const answer =
        isObject(schema) && isObject(schema.properties) ? schema.properties.answer : null;
      return isObject(answer) && Array.isArray(answer.anyOf) ? answer.anyOf : [];
    };
    expect(variants(TOUR_PASS_ANSWER_FORMAT.schema).slice(0, 2)).toEqual(
      variants(PASS_ANSWER_FORMAT.schema),
    );
  });

  it("is sent only when the run asks for the tour", () => {
    expect(passAnswerFormat(undefined)).toBe(PASS_ANSWER_FORMAT);
    expect(passAnswerFormat(false)).toBe(PASS_ANSWER_FORMAT);
    expect(passAnswerFormat(true)).toBe(TOUR_PASS_ANSWER_FORMAT);
  });

  it("parses a steps answer, and refuses a step without an excerpt", () => {
    const step = {
      sentence: "A token is saved",
      excerpts: [{ hunkId: "h_0123456789abcdef", side: "new", startLine: 1, line: 4 }],
    };
    expect(PassAnswer.parse({ answer: { pass: "steps", steps: [step] } }).answer).toEqual({
      pass: "steps",
      steps: [step],
      flow: null,
    });
    expect(
      PassAnswer.safeParse({ answer: { pass: "steps", steps: [{ ...step, excerpts: [] }] } })
        .success,
    ).toBe(false);
  });

  it("parses the data flow a steps answer has, and asks for it in the schema", () => {
    const flow = {
      source: "a request",
      stations: [
        { name: "Take", when: null, keeps: false, files: ["a.ts"], gives: "an order", shapes: [] },
        { name: "Keep", when: null, keeps: true, files: ["b.ts"], gives: null, shapes: [] },
      ],
      end: "the `orders` table",
    };
    const answer = PassAnswer.parse({ answer: { pass: "steps", steps: [], flow } }).answer;
    expect(answer).toEqual({ pass: "steps", steps: [], flow });
    expect(JSON.stringify(TOUR_PASS_ANSWER_FORMAT.schema)).toContain(
      '"required":["pass","steps","flow"]',
    );
    expect(JSON.stringify(PASS_ANSWER_FORMAT.schema)).not.toContain("stations");
  });
});
