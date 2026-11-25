import type { RepoRef, Timestamp } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { Clock, DownloadError, RepositoryCopies, RepositoryCopy } from "../ports/index.ts";
import { type CheckoutCommits, FakeLocalCheckout } from "./fake-local-checkout.ts";
import { FixedClock } from "./fixed-clock.ts";

/** Downloads the commits it's given from a host of its own, and records what it was asked. */
export class FakeRepositoryCopies implements RepositoryCopies {
  readonly downloadFolder: string | null;
  /** "find <sha>" and "download <sha>", in the order asked. */
  readonly asked: string[] = [];
  /** Downloads that reached the host: joined ones count once. */
  downloads = 0;

  private readonly commits: CheckoutCommits;
  private readonly clock: Clock;
  private readonly failures: DownloadError[] = [];
  private held: Promise<void> = Promise.resolve();
  private readonly running = new Map<string, Promise<Result<RepositoryCopy, DownloadError>>>();
  /** Per repository, the commits it has and when it was last read. */
  private readonly copies = new Map<string, { shas: string[]; readAt: string }>();

  constructor(
    options: {
      /** What the host has, whatever the repository. */
      readonly commits?: CheckoutCommits;
      /** Null, the default, turns downloading off. */
      readonly downloadFolder?: string | null;
      readonly clock?: Clock;
    } = {},
  ) {
    this.commits = options.commits ?? {};
    this.downloadFolder = options.downloadFolder ?? null;
    this.clock = options.clock ?? new FixedClock();
  }

  /** The next download fails with this; several queue. */
  failNext(error: DownloadError): void {
    this.failures.push(error);
  }

  /** Downloads wait until the answer is called. */
  hold(): () => void {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.held = promise;
    return resolve;
  }

  async find(repo: RepoRef, sha: string): Promise<RepositoryCopy | null> {
    this.asked.push(`find ${sha}`);
    const copy = this.copies.get(nameOf(repo));
    if (copy === undefined || !copy.shas.includes(sha)) return null;
    copy.readAt = this.clock.now();
    return this.copyOf(repo, copy.shas);
  }

  download(repo: RepoRef, sha: string): Promise<Result<RepositoryCopy, DownloadError>> {
    this.asked.push(`download ${sha}`);
    const key = `${nameOf(repo)}@${sha}`;
    const going = this.running.get(key);
    if (going !== undefined) return going;
    const download = this.fetch(repo, sha).finally(() => this.running.delete(key));
    this.running.set(key, download);
    return download;
  }

  async forget(olderThan: Timestamp): Promise<number> {
    const old = [...this.copies].filter(([, copy]) => copy.readAt < olderThan);
    for (const [name] of old) this.copies.delete(name);
    return old.length;
  }

  private async fetch(repo: RepoRef, sha: string): Promise<Result<RepositoryCopy, DownloadError>> {
    if (this.downloadFolder === null) {
      return err({ kind: "off", message: "Downloading is off." });
    }
    if (this.copies.get(nameOf(repo))?.shas.includes(sha) !== true) {
      this.downloads += 1;
      await this.held;
      const failure = this.failures.shift();
      if (failure !== undefined) return err(failure);
      if (!Object.hasOwn(this.commits, sha)) {
        return err({ kind: "missing-commit", message: `The host doesn't have commit ${sha}.` });
      }
    }
    const had = this.copies.get(nameOf(repo))?.shas ?? [];
    const copy = { shas: [...new Set([...had, sha])], readAt: this.clock.now() };
    this.copies.set(nameOf(repo), copy);
    return ok(this.copyOf(repo, copy.shas));
  }

  private copyOf(repo: RepoRef, shas: readonly string[]): RepositoryCopy {
    const commits = Object.entries(this.commits).filter(([sha]) => shas.includes(sha));
    return {
      checkout: new FakeLocalCheckout(Object.fromEntries(commits)),
      dir: `${this.downloadFolder ?? "/copies"}/${nameOf(repo)}.git`,
    };
  }
}

const nameOf = ({ host, owner, repo }: RepoRef): string => `${host}/${owner}/${repo}`;
