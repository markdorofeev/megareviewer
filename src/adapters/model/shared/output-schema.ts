import { z } from "zod";
import {
  DecisionDraft,
  FindingDraft,
  ModelRisk,
  TourDraft,
} from "../../../application/ports/index.ts";
import { Intent } from "../../../domain/review/index.ts";

/**
 * One schema for all five passes, tagged by pass. The API adds a system prompt for the output
 * format and changing it invalidates the prompt cache, so every pass sends the same one.
 */
export const PassAnswer = z.object({
  answer: z.discriminatedUnion("pass", [
    z.object({ pass: z.literal("intent"), intent: Intent }),
    z.object({ pass: z.literal("findings"), findings: z.array(FindingDraft) }),
    z.object({ pass: z.literal("risk"), assessments: z.array(ModelRisk) }),
    z.object({ pass: z.literal("decisions"), decisions: z.array(DecisionDraft) }),
    z.object({ pass: z.literal("tour"), tour: TourDraft }),
  ]),
});
export type PassAnswer = z.infer<typeof PassAnswer>;

type JsonSchema = { readonly [key: string]: unknown };

/** Keywords structured outputs enforce. Anything else (pattern, minLength) is checked by Zod. */
const KEPT = new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "const",
  "anyOf",
  "description",
]);

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strict = (schema: JsonSchema): JsonSchema => {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(schema)) {
    // Zod writes discriminated unions as oneOf, which structured outputs don't support. The
    // variants' "pass" constants make them exclusive anyway.
    const key = name === "oneOf" ? "anyOf" : name;
    if (!KEPT.has(key)) continue;
    if (key === "properties" && isSchema(value)) {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, property]) => [
          name,
          isSchema(property) ? strict(property) : property,
        ]),
      );
    } else if (key === "items" && isSchema(value)) {
      result[key] = strict(value);
    } else if (key === "anyOf" && Array.isArray(value)) {
      result[key] = value.map((variant: unknown) =>
        isSchema(variant) ? strict(variant) : variant,
      );
    } else {
      result[key] = value;
    }
  }
  if (result.type === "object") result.additionalProperties = false;
  return result;
};

/**
 * The JSON schema sent as the output format. The SDK's Zod helper turns enum and const into
 * descriptions, which would let the model answer with a risk class or category outside the
 * enum; this keeps them, inlines references and drops what the API doesn't support.
 */
export const toStrictJsonSchema = (schema: z.ZodType): JsonSchema =>
  strict(z.toJSONSchema(schema, { reused: "inline", io: "output" }));

export const PASS_ANSWER_FORMAT = {
  type: "json_schema",
  schema: toStrictJsonSchema(PassAnswer),
} as const;
