import type { ModelError, ModelUsage } from "../../../domain/review/index.ts";
import { ok, type Result } from "../../../domain/shared/index.ts";
import type { Effort } from "./effort.ts";

type JsonSchema = { readonly [key: string]: unknown };

/**
 * A model call of its own, apart from the passes: the suggestion of preferences, or the guardrail
 * call of a model run. It shares no cache with them, so it has its own instructions, schema and words, and
 * runs under each transport's lockdown with its data in one message.
 */
export interface OneCall<T> {
  /** opencode runs each as an agent of its own, named by this. */
  readonly name: "suggestion" | "guardrails";
  readonly systemPrompt: string;
  readonly format: { readonly type: "json_schema"; readonly schema: JsonSchema };
  readonly effort: Effort;
  /** The answer's JSON, checked: model output is untrusted. */
  readonly parse: (json: unknown) => Result<T, ModelError>;
  /** A transport's error in this call's words, where its own speak of a pull request's pass. */
  readonly error: (error: ModelError) => ModelError;
  /** What the log says when the call fails, and when it answers. */
  readonly failed: string;
  readonly answered: string;
}

export interface OneCallAnswer {
  readonly answer: unknown;
  /** As a pass's usage, without a pass: the call is none of the four. */
  readonly usage: Omit<ModelUsage, "pass">;
}

/**
 * One transport's way to make a call of its own, locked down as a pass is: the call's answer, or
 * its error in the call's words, logged either way.
 */
export type RunOneCall = (
  call: OneCall<unknown>,
  message: string,
) => Promise<Result<OneCallAnswer, ModelError>>;

/** The call on a transport, its answer parsed. */
export const callOn = async <T>(
  run: RunOneCall,
  call: OneCall<T>,
  message: string,
): Promise<Result<{ value: T; usage: Omit<ModelUsage, "pass"> }, ModelError>> => {
  const called = await run(call, message);
  if (!called.ok) return called;
  const parsed = call.parse(called.value.answer);
  return parsed.ok ? ok({ value: parsed.value, usage: called.value.usage }) : parsed;
};
