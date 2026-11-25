import type { RepoRef } from "../../domain/review/index.ts";
import type { Clock, KnownCheckout, KnownCheckouts } from "../ports/index.ts";
import { FixedClock } from "./fixed-clock.ts";

const sameRepo = (a: RepoRef, b: RepoRef): boolean =>
  a.host === b.host && a.owner === b.owner && a.repo === b.repo;

export class InMemoryKnownCheckouts implements KnownCheckouts {
  /** The most recently read first. */
  private known: readonly KnownCheckout[] = [];
  private readonly clock: Clock;

  constructor(clock: Clock = new FixedClock()) {
    this.clock = clock;
  }

  async foldersRead(repo: RepoRef): Promise<readonly string[]> {
    return this.known.filter((one) => sameRepo(one.repo, repo)).map((one) => one.dir);
  }

  async rememberFolder(repo: RepoRef, dir: string): Promise<void> {
    await this.forgetFolder(repo, dir);
    this.known = [{ repo, dir, lastReadAt: this.clock.now() }, ...this.known];
  }

  async forgetFolder(repo: RepoRef, dir: string): Promise<void> {
    this.known = this.known.filter((one) => !sameRepo(one.repo, repo) || one.dir !== dir);
  }

  async knownCheckouts(): Promise<readonly KnownCheckout[]> {
    return this.known;
  }
}
