import type { ModelError } from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";
import type { AdviceDraft, AdviceInput, AdviceOutput, GuardrailAdvisor } from "../ports/index.ts";

/**
 * Answers scripted results in order, then `answer` on every call, no marks by default. `calls`
 * keeps what it was asked; a call made while `hold` is on waits until it's released.
 */
export class FakeGuardrailAdvisor implements GuardrailAdvisor {
  readonly calls: AdviceInput[] = [];
  private readonly answer: AdviceDraft;
  private readonly scripts: Result<AdviceDraft, ModelError>[] = [];
  private held: Promise<void> | null = null;

  constructor(options: { readonly answer?: AdviceDraft } = {}) {
    this.answer = options.answer ?? { marks: [] };
  }

  script(...answers: Result<AdviceDraft, ModelError>[]): void {
    this.scripts.push(...answers);
  }

  /** Holds every call until the returned function is called. */
  hold(): () => void {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.held = promise;
    return () => {
      this.held = null;
      resolve();
    };
  }

  async advise(input: AdviceInput): Promise<Result<AdviceOutput, ModelError>> {
    this.calls.push(input);
    if (this.held !== null) await this.held;
    const answer = this.scripts.shift() ?? ok(this.answer);
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
