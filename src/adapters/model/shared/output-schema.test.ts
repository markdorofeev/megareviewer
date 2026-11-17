import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PASS_ANSWER_FORMAT, PassAnswer, toStrictJsonSchema } from "./output-schema.ts";

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

  it("is a union of the four passes, one variant each", () => {
    expect(json.match(/"const":"(intent|findings|risk|decisions)"/g)).toEqual([
      '"const":"intent"',
      '"const":"findings"',
      '"const":"risk"',
      '"const":"decisions"',
    ]);
    expect(json).not.toContain("oneOf");
  });

  it("keeps the enums, so the model can't answer outside them", () => {
    expect(json).toContain('"enum":["logic","contract"]');
    expect(json).toContain('"enum":["unrequested","missing","contradicts"]');
  });

  it("asks the intent for its whole brief: the summary, the shape and what to watch", () => {
    const [intent] = objects(schema).filter(
      (node) => isObject(node.properties) && "behaviorChanges" in node.properties,
    );
    expect(intent?.required).toEqual(["summary", "shape", "behaviorChanges", "watch"]);
  });

  it("asks each risk for its checking test, or null, by its test's name, lines and what it checks", () => {
    const [risk] = objects(schema).filter(
      (node) => isObject(node.properties) && "riskClass" in node.properties,
    );
    expect(risk?.required).toContain("checkedBy");
    const [test] = objects(schema).filter(
      (node) => isObject(node.properties) && "checks" in node.properties,
    );
    expect(test?.required).toEqual(["hunkId", "test", "startLine", "line", "checks"]);
  });

  it("asks each finding and each risk for the guidance that shaped it, or null", () => {
    const marked = objects(schema).filter(
      (node) => isObject(node.properties) && "guidance" in node.properties,
    );
    expect(marked.map((node) => Object.keys(node.properties ?? {})[0])).toEqual([
      "title",
      "hunkId",
    ]);
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
