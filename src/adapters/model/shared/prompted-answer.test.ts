import { describe, expect, it } from "vitest";
import { ModelPass } from "../../../domain/review/index.ts";
import { PassAnswer, TOUR_PASS_ANSWER_FORMAT } from "./output-schema.ts";
import { answerJson, passSchema, passText } from "./prompted-answer.ts";

describe("passSchema", () => {
  it("is the pass's variant of the union alone, the steps pass's too, under the same wrapper", () => {
    for (const pass of ModelPass.options) {
      const schema = passSchema(pass);
      expect(schema).toMatchObject({
        type: "object",
        required: ["answer"],
        additionalProperties: false,
      });
      const json = JSON.stringify(schema);
      expect(json.match(/"pass":\{"type":"string","const":"\w+"\}/g)).toEqual([
        `"pass":{"type":"string","const":"${pass}"}`,
      ]);
      expect(JSON.stringify(TOUR_PASS_ANSWER_FORMAT.schema)).toContain(
        JSON.stringify(schema.properties).slice('{"answer":'.length, -1),
      );
    }
  });
});

describe("passText", () => {
  it("ends the pass's message with how to answer and the pass's schema", () => {
    const text = passText("findings", "Task: findings.");
    expect(text.startsWith("Task: findings.\n\nAnswer with one JSON object and nothing else")).toBe(
      true,
    );
    expect(text.endsWith(`\n${JSON.stringify(passSchema("findings"))}`)).toBe(true);
  });
});

describe("answerJson", () => {
  const json = '{"answer":{"pass":"findings","findings":[]}}';

  it("reads an object the shared schema accepts", () => {
    expect(PassAnswer.safeParse(answerJson(json)).success).toBe(true);
  });

  it.each([
    ["a code fence", `\`\`\`json\n${json}\n\`\`\``],
    ["a bare code fence", `\`\`\`\n${json}\n\`\`\``],
    ["a sentence before it", `Here is the answer:\n${json}`],
    ["space around it", `\n  ${json}\n`],
  ])("reads the object inside %s", (_name, text) => {
    expect(answerJson(text)).toEqual(JSON.parse(json));
  });

  it.each([
    ["no object", "I can't do that."],
    ["an object cut short", '{"answer":{"pass":"findings"'],
    ["braces out of order", "} {"],
    ["an array", "[1, 2]"],
  ])("is undefined for %s", (_name, text) => {
    expect(answerJson(text)).toBeUndefined();
  });
});
