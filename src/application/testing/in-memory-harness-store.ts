import type { BlobHash, Harness, RepoRef, Timestamp } from "../../domain/review/index.ts";
import type { Clock, HarnessBlob, HarnessStore } from "../ports/index.ts";
import { FixedClock } from "./fixed-clock.ts";

const repoKey = ({ host, owner, repo }: RepoRef): string => `${host}/${owner}/${repo}`;

/** Copies on every read and write, so a test that mutates stored data fails loudly. */
export class InMemoryHarnessStore implements HarnessStore {
  private readonly clock: Clock;
  /** Each repository's, the one put last at the end. */
  private readonly harnesses = new Map<string, Map<string, { harness: Harness; putAt: string }>>();
  private readonly blobs = new Map<string, Map<BlobHash, { content: string; usedAt: string }>>();

  constructor(clock: Clock = new FixedClock()) {
    this.clock = clock;
  }

  async getHarness(repo: RepoRef, sha: string): Promise<Harness | null> {
    return structuredClone(this.harnesses.get(repoKey(repo))?.get(sha)?.harness ?? null);
  }

  async putHarness(repo: RepoRef, harness: Harness): Promise<void> {
    const harnesses = this.harnesses.get(repoKey(repo)) ?? new Map();
    harnesses.delete(harness.baseSha);
    harnesses.set(harness.baseSha, {
      harness: structuredClone(harness),
      putAt: this.clock.now(),
    });
    this.harnesses.set(repoKey(repo), harnesses);
  }

  async latestHarness(repo: RepoRef): Promise<Harness | null> {
    const latest = [...(this.harnesses.get(repoKey(repo))?.values() ?? [])].at(-1);
    return structuredClone(latest?.harness ?? null);
  }

  async getBlobs(
    repo: RepoRef,
    blobs: readonly BlobHash[],
  ): Promise<ReadonlyMap<BlobHash, string>> {
    const found = new Map<BlobHash, string>();
    for (const blob of blobs) {
      const stored = this.blobs.get(repoKey(repo))?.get(blob);
      if (stored === undefined) continue;
      stored.usedAt = this.clock.now();
      found.set(blob, stored.content);
    }
    return found;
  }

  async putBlobs(repo: RepoRef, entries: readonly HarnessBlob[]): Promise<void> {
    const blobs = this.blobs.get(repoKey(repo)) ?? new Map();
    for (const { blob, content } of entries) {
      blobs.set(blob, { content, usedAt: this.clock.now() });
    }
    this.blobs.set(repoKey(repo), blobs);
  }

  async dropUnusedSince(time: Timestamp): Promise<void> {
    const before = (at: string) => Date.parse(at) < Date.parse(time);
    for (const blobs of this.blobs.values()) {
      for (const [blob, { usedAt }] of blobs) if (before(usedAt)) blobs.delete(blob);
    }
    for (const harnesses of this.harnesses.values()) {
      for (const [sha, { putAt }] of harnesses) if (before(putAt)) harnesses.delete(sha);
    }
  }
}
