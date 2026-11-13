import { beforeEach, describe, expect, it } from "vitest";
import type { RepoRef } from "../../../domain/review/index.ts";
import type { FileCache } from "../../ports/index.ts";

const repo: RepoRef = { host: "github", owner: "acme", repo: "shop" };
const sha = "a".repeat(40);

export const describeFileCacheContract = (name: string, setup: () => FileCache): void => {
  describe(`FileCache contract: ${name}`, () => {
    let cache: FileCache;
    beforeEach(() => {
      cache = setup();
    });

    it("misses a file it hasn't been given", async () => {
      expect(await cache.get(repo, { sha, path: "a.ts" })).toBeNull();
    });

    it("returns a file's content", async () => {
      await cache.put(repo, { sha, path: "a.ts" }, "export {};");
      expect(await cache.get(repo, { sha, path: "a.ts" })).toEqual({ content: "export {};" });
    });

    it("remembers that a file isn't at a commit", async () => {
      await cache.put(repo, { sha, path: "gone.ts" }, null);
      expect(await cache.get(repo, { sha, path: "gone.ts" })).toEqual({ content: null });
    });

    it("keeps files apart by host, repo, commit and path", async () => {
      await cache.put(repo, { sha, path: "a.ts" }, "here");
      const others: [RepoRef, string, string][] = [
        [{ ...repo, host: "bitbucket" }, sha, "a.ts"],
        [{ ...repo, owner: "other" }, sha, "a.ts"],
        [{ ...repo, repo: "other" }, sha, "a.ts"],
        [repo, "b".repeat(40), "a.ts"],
        [repo, sha, "A.ts"],
      ];
      for (const [otherRepo, otherSha, path] of others) {
        expect(await cache.get(otherRepo, { sha: otherSha, path })).toBeNull();
      }
    });

    it("keeps the latest content put for a file", async () => {
      await cache.put(repo, { sha, path: "a.ts" }, "first");
      await cache.put(repo, { sha, path: "a.ts" }, "second");
      expect(await cache.get(repo, { sha, path: "a.ts" })).toEqual({ content: "second" });
    });
  });
};
