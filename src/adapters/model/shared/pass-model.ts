import { z } from "zod";
import type {
  AnalysisInput,
  AnalysisModel,
  PassOptions,
  PassOutput,
} from "../../../application/ports/index.ts";
import type { Intent, ModelError, ModelPass, ModelUsage } from "../../../domain/review/index.ts";
import { err, ok, type Result } from "../../../domain/shared/index.ts";
import { invalidOutput } from "./errors.ts";
import { PassAnswer } from "./output-schema.ts";

export type Answer = PassAnswer["answer"];

export interface AnsweredPass {
  readonly answer: unknown;
  readonly usage: ModelUsage;
}

/** One pass on one transport: the model's answer as it came, unparsed, and what it used. */
export type RunPass = (
  pass: ModelPass,
  input: AnalysisInput,
  intent: Intent | null,
  options: PassOptions | undefined,
) => Promise<Result<AnsweredPass, ModelError>>;

export const parseAnswer = (json: unknown): Result<Answer, ModelError> => {
  const answer = PassAnswer.safeParse(json);
  return answer.success
    ? ok(answer.data.answer)
    : err(invalidOutput(z.prettifyError(answer.error)));
};

/** The four passes over a transport's `runPass`, which every pass shares. */
export const createPassModel = (transport: {
  readonly version: string;
  readonly checkSize: AnalysisModel["checkSize"];
  readonly runPass: RunPass;
}): AnalysisModel => {
  const run = async <T>(
    pass: ModelPass,
    input: AnalysisInput,
    intent: Intent | null,
    options: PassOptions | undefined,
    pick: (answer: Answer) => T | null,
  ): Promise<Result<PassOutput<T>, ModelError>> => {
    const answered = await transport.runPass(pass, input, intent, options);
    if (!answered.ok) return answered;
    const answer = parseAnswer(answered.value.answer);
    if (!answer.ok) return answer;
    const value = pick(answer.value);
    if (value === null) {
      return err(invalidOutput(`answered the ${answer.value.pass} task instead of ${pass}`));
    }
    return ok({ value, usage: answered.value.usage });
  };

  return {
    version: transport.version,
    checkSize: transport.checkSize,

    intent: (input, options) =>
      run("intent", input, null, options, (answer) =>
        answer.pass === "intent" ? answer.intent : null,
      ),

    findings: (input, intent, options) =>
      run("findings", input, intent, options, (answer) =>
        answer.pass === "findings" ? answer.findings : null,
      ),

    risk: (input, options) =>
      run("risk", input, null, options, (answer) =>
        answer.pass === "risk" ? answer.assessments : null,
      ),

    decisions: (input, options) =>
      run("decisions", input, null, options, (answer) =>
        answer.pass === "decisions" ? answer.decisions : null,
      ),
  };
};
