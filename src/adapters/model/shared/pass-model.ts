import { z } from "zod";
import type {
  AnalysisInput,
  AnalysisModel,
  PassError,
  PassOptions,
  PassOutput,
} from "../../../application/ports/index.ts";
import type {
  HarnessRead,
  Intent,
  ModelError,
  ModelPass,
  ModelUsage,
} from "../../../domain/review/index.ts";
import { err, ok, type Result } from "../../../domain/shared/index.ts";
import { invalidOutput } from "./errors.ts";
import { PassAnswer } from "./output-schema.ts";

export type Answer = PassAnswer["answer"];

export interface AnsweredPass {
  readonly answer: unknown;
  readonly usage: ModelUsage;
  /** What it read of the harness; none when absent. */
  readonly reads?: readonly HarnessRead[];
}

/** One pass on one transport: the model's answer as it came, unparsed, and what it used. */
export type RunPass = (
  pass: ModelPass,
  input: AnalysisInput,
  intent: Intent | null,
  options: PassOptions | undefined,
) => Promise<Result<AnsweredPass, PassError>>;

export const parseAnswer = (json: unknown): Result<Answer, ModelError> => {
  const answer = PassAnswer.safeParse(json);
  return answer.success
    ? ok(answer.data.answer)
    : err(invalidOutput(z.prettifyError(answer.error)));
};

/** The passes over a transport's `runPass`, which every pass shares. */
export const createPassModel = (transport: {
  readonly version: string;
  readonly readsHarness: boolean;
  readonly checkSize: AnalysisModel["checkSize"];
  readonly runPass: RunPass;
}): AnalysisModel => {
  const run = async <T>(
    pass: ModelPass,
    input: AnalysisInput,
    intent: Intent | null,
    options: PassOptions | undefined,
    pick: (answer: Answer) => T | null,
  ): Promise<Result<PassOutput<T>, PassError>> => {
    const answered = await transport.runPass(pass, input, intent, options);
    if (!answered.ok) return answered;
    const { usage, reads } = answered.value;
    const read = reads === undefined ? {} : { reads };
    const answer = parseAnswer(answered.value.answer);
    if (!answer.ok) return err({ ...answer.error, ...read });
    const value = pick(answer.value);
    if (value === null) {
      return err({
        ...invalidOutput(`answered the ${answer.value.pass} task instead of ${pass}`),
        ...read,
      });
    }
    return ok({ value, usage, ...read });
  };

  return {
    version: transport.version,
    readsHarness: transport.readsHarness,
    checkSize: transport.checkSize,

    intent: (input, options) =>
      run("intent", input, null, options, (answer) =>
        answer.pass === "intent" ? answer.intent : null,
      ),

    findings: (input, intent, options) =>
      run("findings", input, intent, options, (answer) =>
        answer.pass === "findings" ? answer.findings : null,
      ),

    steps: (input, options) =>
      run("steps", input, null, options, (answer) =>
        answer.pass === "steps" ? { steps: answer.steps, flow: answer.flow } : null,
      ),
  };
};
