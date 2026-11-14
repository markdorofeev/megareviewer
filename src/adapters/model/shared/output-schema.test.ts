import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PASS_ANSWER_FORMAT, toStrictJsonSchema } from "./output-schema.ts";

/** Every object schema inside `schema`, at any depth. */
const objects = (schema: unknown): Record<string, unknown>[] => {
  if (Array.isArray(schema)) return schema.flatMap(objects);
  if (typeof schema !== "object" || schema === null) return [];
  return [Object.fromEntries(Object.entries(schema)), ...Object.values(schema).flatMap(objects)];
};

describe("the answer format", () => {
  const { schema } = PASS_ANSWER_FORMAT;
  const json = JSON.stringify(schema);

  it("is a union of the four passes, one variant each", () => {
    expect(json.match(/"const":"(intent|risk|decisions|tour)"/g)).toEqual([
      '"const":"intent"',
      '"const":"risk"',
      '"const":"decisions"',
      '"const":"tour"',
    ]);
    expect(json).not.toContain("oneOf");
  });

  it("keeps the enums, so the model can't answer outside them", () => {
    expect(json).toContain('"enum":["logic","contract"]');
    expect(json).toContain('"enum":["unrequested","missing","contradicts"]');
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
