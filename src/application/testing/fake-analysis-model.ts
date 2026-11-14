import type { Intent, ModelError, ModelPass, ModelUsage } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type {
  AnalysisInput,
  AnalysisModel,
  DecisionDraft,
  FindingDraft,
  ModelRisk,
  PassOptions,
  PassOutput,
} from "../ports/index.ts";

export interface PassValues {
  intent: Intent;
  findings: FindingDraft[];
  risk: ModelRisk[];
  decisions: DecisionDraft[];
}

/** A scripted answer to one pass call: a value (valid or not) or an error. */
export type ScriptedPass<P extends ModelPass> = Result<PassValues[P], ModelError>;

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
 * when none are left: a finding on the first added line, every hunk sent in full is logic, one
 * decision per file.
 */
export class FakeAnalysisModel implements AnalysisModel {
  readonly version: string;
  readonly calls: ModelCall[] = [];
  private readonly maxInputTokens: number;
  private readonly scripts: { [P in ModelPass]: ScriptedPass<P>[] } = {
    intent: [],
    findings: [],
    risk: [],
    decisions: [],
  };

  constructor(options: { version?: string; maxInputTokens?: number } = {}) {
    this.version = options.version ?? "fake-model/1";
    this.maxInputTokens = options.maxInputTokens ?? Number.POSITIVE_INFINITY;
  }

  script<P extends ModelPass>(pass: P, ...answers: ScriptedPass<P>[]): void {
    this.scripts[pass].push(...answers);
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
  ): Promise<Result<PassOutput<Intent>, ModelError>> {
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
    options?: PassOptions,
  ): Promise<Result<PassOutput<FindingDraft[]>, ModelError>> {
    return this.answer("findings", input, options, () =>
      input.files
        .flatMap((file) => file.hunks)
        .flatMap((hunk) => {
          const line = hunk.lines.find((one) => one.kind === "add")?.newLine;
          return line == null
            ? []
            : [
                {
                  title: `Check ${hunk.path}`,
                  explanation: "Derived by the fake model.",
                  lines: { hunkId: hunk.id, side: "new" as const, startLine: line, line },
                  severity: "major" as const,
                  suggestion: null,
                },
              ];
        })
        .slice(0, 1),
    );
  }

  async risk(
    input: AnalysisInput,
    options?: PassOptions,
  ): Promise<Result<PassOutput<ModelRisk[]>, ModelError>> {
    return this.answer("risk", input, options, () =>
      input.files.flatMap((file) =>
        file.hunks.map((hunk) => ({
          hunkId: hunk.id,
          riskClass: "logic" as const,
          reason: "Ordinary code change",
          lines: null,
        })),
      ),
    );
  }

  async decisions(
    input: AnalysisInput,
    options?: PassOptions,
  ): Promise<Result<PassOutput<DecisionDraft[]>, ModelError>> {
    return this.answer("decisions", input, options, () =>
      filesToReview(input).map((file) => ({
        title: `Changes ${file.path}`,
        category: "behavior" as const,
        whyItMatters: "Derived by the fake model.",
        hunkIds: file.hunks.map((hunk) => hunk.id),
        lines: null,
      })),
    );
  }

  private async answer<P extends ModelPass>(
    pass: P,
    input: AnalysisInput,
    options: PassOptions | undefined,
    derive: () => PassValues[P],
  ): Promise<Result<PassOutput<PassValues[P]>, ModelError>> {
    this.calls.push({ pass, input, options });
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
    return ok({ value: answer.value, usage });
  }
}
