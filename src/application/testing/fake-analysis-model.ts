import type {
  HarnessRead,
  Intent,
  ModelError,
  ModelPass,
  ModelUsage,
  StepDraft,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type {
  AnalysisInput,
  AnalysisModel,
  FindingDraft,
  PassError,
  PassOptions,
  PassOutput,
} from "../ports/index.ts";

export interface PassValues {
  intent: Intent;
  findings: FindingDraft[];
  steps: StepDraft[];
}

/** A scripted answer to one pass call: a value (valid or not) or an error. */
export type ScriptedPass<P extends ModelPass> = Result<PassValues[P], PassError>;

export interface ModelCall {
  readonly pass: ModelPass | "checkSize";
  readonly input: AnalysisInput;
  readonly options: PassOptions | undefined;
}

/** Roughly what a tokenizer would count, enough to exercise size budgets. */
const estimateTokens = (input: AnalysisInput): number =>
  Math.ceil(JSON.stringify(input).length / 4);

const filesToReview = (input: AnalysisInput) => input.files.filter((file) => file.hunks.length > 0);

/**
 * Returns scripted answers per pass, in order, and derives plausible ones from the input
 * when none are left: a finding on the first added line of each file.
 */
export class FakeAnalysisModel implements AnalysisModel {
  readonly version: string;
  readonly readsHarness: boolean;
  readonly calls: ModelCall[] = [];
  private readonly maxInputTokens: number;
  private readonly scripts: { [P in ModelPass]: ScriptedPass<P>[] } = {
    intent: [],
    findings: [],
    steps: [],
  };

  private readonly scriptedReads: { [P in ModelPass]: (readonly HarnessRead[])[] } = {
    intent: [],
    findings: [],
    steps: [],
  };

  constructor(options: { version?: string; maxInputTokens?: number; readsHarness?: boolean } = {}) {
    this.version = options.version ?? "fake-model/1";
    this.readsHarness = options.readsHarness ?? false;
    this.maxInputTokens = options.maxInputTokens ?? Number.POSITIVE_INFINITY;
  }

  script<P extends ModelPass>(pass: P, ...answers: ScriptedPass<P>[]): void {
    this.scripts[pass].push(...answers);
  }

  /** What the pass's next answer says it read. Queued beside the scripted answers. */
  scriptReads(pass: ModelPass, ...reads: (readonly HarnessRead[])[]): void {
    this.scriptedReads[pass].push(...reads);
  }

  callsTo(pass: ModelCall["pass"]): ModelCall[] {
    return this.calls.filter((call) => call.pass === pass);
  }

  async checkSize(input: AnalysisInput): Promise<Result<{ inputTokens: number }, ModelError>> {
    this.calls.push({ pass: "checkSize", input, options: undefined });
    const inputTokens = estimateTokens(input);
    return inputTokens > this.maxInputTokens
      ? err({
          kind: "too-large",
          message: `${inputTokens} input tokens is over the limit of ${this.maxInputTokens}`,
        })
      : ok({ inputTokens });
  }

  async intent(
    input: AnalysisInput,
    options?: PassOptions,
  ): Promise<Result<PassOutput<Intent>, PassError>> {
    return this.answer("intent", input, options, () => {
      const { description } = input.pullRequest;
      const sources = [
        ...(description.trim() === "" ? [] : [{ kind: "description" as const, ref: null }]),
        ...input.tickets.map((ticket) => ({ kind: "ticket" as const, ref: ticket.key })),
      ];
      const files = filesToReview(input);
      return {
        stated: sources.length === 0 ? null : { summary: input.pullRequest.title, sources },
        inferred: {
          summary: `Changes ${files.length} file(s).`,
          behaviorChanges: files.map((file) => `Changes ${file.path}`),
        },
        mismatches: [],
      };
    });
  }

  async findings(
    input: AnalysisInput,
    _intent: Intent | null,
    options?: PassOptions,
  ): Promise<Result<PassOutput<FindingDraft[]>, PassError>> {
    return this.answer("findings", input, options, () =>
      filesToReview(input).flatMap((file) => {
        const added = file.hunks.flatMap((hunk) => {
          const line = hunk.lines.find((one) => one.kind === "add")?.newLine;
          return line == null
            ? []
            : [{ hunkId: hunk.id, side: "new" as const, startLine: line, line }];
        });
        return added.slice(0, 1).map((lines) => ({
          title: `Check ${file.path}`,
          explanation: "Derived by the fake model.",
          lines,
          type: "logic" as const,
          severity: "major" as const,
          suggestion: null,
          mismatch: null,
          guidance: null,
        }));
      }),
    );
  }

  /** Derives no tour: a fake can't follow calls. Tests script the steps they need. */
  async steps(
    input: AnalysisInput,
    options?: PassOptions,
  ): Promise<Result<PassOutput<StepDraft[]>, PassError>> {
    return this.answer("steps", input, options, () => []);
  }

  private async answer<P extends ModelPass>(
    pass: P,
    input: AnalysisInput,
    options: PassOptions | undefined,
    derive: () => PassValues[P],
  ): Promise<Result<PassOutput<PassValues[P]>, PassError>> {
    this.calls.push({ pass, input, options });
    options?.onAnswering?.();
    const answer = this.scripts[pass].shift() ?? ok(derive());
    if (!answer.ok) return answer;
    const usage: ModelUsage = {
      pass,
      inputTokens: estimateTokens(input),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: Math.ceil(JSON.stringify(answer.value).length / 4),
      costUsd: 0,
      billing: "api",
    };
    const reads = this.scriptedReads[pass].shift();
    return ok({ value: answer.value, usage, ...(reads === undefined ? {} : { reads }) });
  }
}
