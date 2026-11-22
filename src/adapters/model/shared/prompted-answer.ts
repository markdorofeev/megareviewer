import type { ModelPass } from "../../../domain/review/index.ts";
import { TOUR_PASS_ANSWER_FORMAT } from "./output-schema.ts";

type JsonSchema = { readonly [key: string]: unknown };

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The schema of one pass's answer: its variant of the union, which Claude Code and Codex enforce
 * whole. Asked for in the prompt, a smaller schema is one the model can follow. It's the same
 * whether the run asked for the tour or not, since the tour only adds the steps pass's variant.
 */
export const passSchema = (pass: ModelPass): JsonSchema => {
  const answer = TOUR_PASS_ANSWER_FORMAT.schema.properties;
  const variants = isSchema(answer) && isSchema(answer.answer) ? answer.answer.anyOf : undefined;
  const variant = Array.isArray(variants)
    ? variants.find(
        (candidate: unknown) =>
          isSchema(candidate) &&
          isSchema(candidate.properties) &&
          isSchema(candidate.properties.pass) &&
          candidate.properties.pass.const === pass,
      )
    : undefined;
  if (!isSchema(variant)) throw new Error(`No answer schema for the ${pass} pass`);
  return {
    type: "object",
    properties: { answer: variant },
    required: ["answer"],
    additionalProperties: false,
  };
};

/**
 * The pass's own message, then how to answer, for a transport that can't enforce the union:
 * opencode has no structured output a prompt can ask for, and the Anthropic API refuses the union
 * as too large a grammar. The schema is in the prompt and the answer is checked against it.
 */
export const passText = (pass: ModelPass, message: string): string =>
  `${message}

Answer with one JSON object and nothing else: no prose before or after it, no code fence. It must match this JSON schema:
${JSON.stringify(passSchema(pass))}`;

const FENCE = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/;

/**
 * The JSON object an answer holds. Asked for one object and nothing else, a model may still wrap it
 * in a code fence or a sentence, so the outermost braces are taken.
 */
export const answerJson = (text: string): unknown => {
  const trimmed = text.trim();
  const fenced = FENCE.exec(trimmed)?.[1] ?? trimmed;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end < start) return undefined;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return undefined;
  }
};
