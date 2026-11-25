import { beforeEach, describe, expect, it } from "vitest";
import type { RepoRef } from "../../../domain/review/index.ts";
import type { RepositoryCopies } from "../../ports/index.ts";
import type { FixedClock } from "../fixed-clock.ts";

export interface RepositoryCopiesContractSetup {
  readonly copies: RepositoryCopies;
  /** With downloading off. */
  readonly off: RepositoryCopies;
  readonly clock: FixedClock;
  /** Two repositories the host has, each with both commits. */
  readonly repo: RepoRef;
  readonly other: RepoRef;
  readonly sha: string;
  readonly later: string;
  /** A file at both commits. */
  readonly path: string;
}

const MISSING = "0123456789abcdef0123456789abcdef01234567";
const DAY_MS = 24 * 60 * 60 * 1000;

export const describeRepositoryCopiesContract = (
  name: string,
  setup: () => Promise<RepositoryCopiesContractSetup>,
): void => {
  describe(`RepositoryCopies contract: ${name}`, () => {
    let made: RepositoryCopiesContractSetup;
    beforeEach(async () => {
      made = await setup();
    });

    const downloaded = async (repo: RepoRef, sha: string) => {
      const result = await made.copies.download(repo, sha);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };

    it("has no copy before a download", async () => {
      expect(await made.copies.find(made.repo, made.sha)).toBeNull();
    });

    it("downloads a commit, which the copy then has and reads", async () => {
      const copy = await downloaded(made.repo, made.sha);
      expect(await copy.checkout.hasCommit(made.sha)).toBe(true);
      const read = await copy.checkout.readFiles(made.sha, [made.path]);
      expect(read.ok && read.value[0]?.kind).toBe("text");
      expect(copy.dir.startsWith(`${made.copies.downloadFolder}/`)).toBe(true);
      expect((await made.copies.find(made.repo, made.sha))?.dir).toBe(copy.dir);
    });

    it("keeps a repository's commits in one copy, and repositories apart", async () => {
      const first = await downloaded(made.repo, made.sha);
      expect(await made.copies.find(made.repo, made.later)).toBeNull();
      const second = await downloaded(made.repo, made.later);
      expect(second.dir).toBe(first.dir);
      expect(await second.checkout.hasCommit(made.sha)).toBe(true);
      expect(await made.copies.find(made.other, made.sha)).toBeNull();
      expect((await downloaded(made.other, made.sha)).dir).not.toBe(first.dir);
    });

    it("answers a commit it already has", async () => {
      const first = await downloaded(made.repo, made.sha);
      expect((await downloaded(made.repo, made.sha)).dir).toBe(first.dir);
    });

    it("answers requests made at once, for one commit and for two", async () => {
      const results = await Promise.all([
        made.copies.download(made.repo, made.sha),
        made.copies.download(made.repo, made.sha),
        made.copies.download(made.repo, made.later),
      ]);
      expect(results.map((result) => result.ok)).toEqual([true, true, true]);
      for (const sha of [made.sha, made.later]) {
        expect(await made.copies.find(made.repo, sha)).not.toBeNull();
      }
    });

    it("says when the host doesn't have the commit, and has no copy of it", async () => {
      const result = await made.copies.download(made.repo, MISSING);
      expect(!result.ok && result.error.kind).toBe("missing-commit");
      expect(await made.copies.find(made.repo, MISSING)).toBeNull();
      // Another commit still downloads.
      await downloaded(made.repo, made.sha);
    });

    it("downloads nothing while it's off", async () => {
      expect(made.off.downloadFolder).toBeNull();
      const result = await made.off.download(made.repo, made.sha);
      expect(!result.ok && result.error.kind).toBe("off");
      expect(await made.off.find(made.repo, made.sha)).toBeNull();
    });

    it("forgets the copies not read since, and keeps the others", async () => {
      await downloaded(made.repo, made.sha);
      await downloaded(made.other, made.sha);
      made.clock.advance(30 * DAY_MS);
      // Read yesterday, by finding it.
      await made.copies.find(made.other, made.sha);
      made.clock.advance(DAY_MS);
      const since = new Date(Date.parse(made.clock.now()) - 30 * DAY_MS).toISOString();
      expect(await made.copies.forget(since)).toBe(1);
      expect(await made.copies.find(made.repo, made.sha)).toBeNull();
      expect(await made.copies.find(made.other, made.sha)).not.toBeNull();
      expect(await made.copies.forget(since)).toBe(0);
    });
  });
};
