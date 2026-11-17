import type { ModelError } from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";
import type {
  PreferenceSuggester,
  ProposalDraft,
  SuggestionInput,
  SuggestionOutput,
} from "../ports/index.ts";

/**
 * Answers scripted results in order, then `drafts` on every call. `calls` keeps what it was asked.
 */
export class FakePreferenceSuggester implements PreferenceSuggester {
  readonly calls: SuggestionInput[] = [];
  private readonly drafts: readonly ProposalDraft[];
  private readonly scripts: Result<readonly ProposalDraft[], ModelError>[] = [];

  constructor(options: { readonly drafts?: readonly ProposalDraft[] } = {}) {
    this.drafts = options.drafts ?? [];
  }

  script(...answers: Result<readonly ProposalDraft[], ModelError>[]): void {
    this.scripts.push(...answers);
  }

  async suggest(input: SuggestionInput): Promise<Result<SuggestionOutput, ModelError>> {
    this.calls.push(input);
    const answer = this.scripts.shift() ?? ok(this.drafts);
    if (!answer.ok) return answer;
    return ok({
      value: answer.value,
      usage: {
        inputTokens: Math.ceil(JSON.stringify(input).length / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: Math.ceil(JSON.stringify(answer.value).length / 4),
        costUsd: 0,
        billing: "api",
      },
    });
  }
}
