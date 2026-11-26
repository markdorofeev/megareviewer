import { beforeEach, describe, expect, it } from "vitest";
import { BlobHash, type HarnessSkipReason, type RepoRef } from "../../../domain/review/index.ts";
import type { HarnessSource } from "../../ports/index.ts";

export interface HarnessSourceContractFile {
  readonly path: string;
  readonly content: string;
  /** `git hash-object`'s, written down rather than computed by what's tested. */
  readonly blob: string;
}

export interface HarnessSourceContractSetup {
  /** "unauthorized": every request is refused for its credentials. */
  source(scenario: "normal" | "unauthorized"): HarnessSource;
  /** Whether the source lists a commit's files, and says what changed between two. */
  readonly lists: boolean;
  readonly diffs: boolean;
  readonly repo: RepoRef;
  readonly sha: string;
  /** Two or more text files at `sha`, one in a directory and one with non-ASCII text. */
  readonly files: readonly HarnessSourceContractFile[];
  readonly directory: string;
  /** A path that isn't at `sha`. */
  readonly missingPath: string;
  /** A file at `sha` the source won't give as text, when its host can tell one from a missing path. */
  readonly skipped?: { readonly path: string; readonly reason: HarnessSkipReason };
  /** Null for a source that can't say what changed. `paths` include both of a renamed file's. */
  readonly change: {
    readonly fromSha: string;
    readonly toSha: string;
    readonly paths: readonly string[];
  } | null;
}

export const describeHarnessSourceContract = (
  name: string,
  setup: () => HarnessSourceContractSetup,
): void => {
  describe(`HarnessSource contract: ${name}`, () => {
    let s: HarnessSourceContractSetup;
    let source: HarnessSource;
    beforeEach(() => {
      s = setup();
      source = s.source("normal");
    });

    it("lists every file at a commit with git's hash of it, or says it can't", async () => {
      const listed = await source.listFiles(s.repo, s.sha);
      if (!listed.ok) throw new Error(`listFiles failed: ${listed.error.message}`);
      if (!s.lists) {
        expect(listed.value).toBeNull();
        return;
      }
      const paths = listed.value ?? new Map<string, string>();
      for (const { path, blob } of s.files) expect([path, paths.get(path)]).toEqual([path, blob]);
      for (const blob of paths.values()) expect(BlobHash.safeParse(blob).success).toBe(true);
      expect(paths.has(s.directory)).toBe(false);
      expect(paths.has(s.missingPath)).toBe(false);
      if (s.skipped !== undefined) expect(paths.has(s.skipped.path)).toBe(true);
    });

    it("reads files in the order asked, with git's hash, null for what isn't a file there", async () => {
      const asked = [...s.files].reverse();
      const read = await source.readFiles(s.repo, s.sha, [
        s.missingPath,
        ...asked.map(({ path }) => path),
        s.directory,
      ]);
      expect(read).toEqual({
        ok: true,
        value: [null, ...asked.map(({ content, blob }) => ({ kind: "text", content, blob })), null],
      });
    });

    it("says why it won't give a file's text", async () => {
      if (s.skipped === undefined) return;
      const { path, reason } = s.skipped;
      expect(await source.readFiles(s.repo, s.sha, [path])).toEqual({
        ok: true,
        value: [{ kind: "skipped", reason }],
      });
    });

    it("reads nothing when asked for nothing", async () => {
      expect(await source.readFiles(s.repo, s.sha, [])).toEqual({ ok: true, value: [] });
    });

    it("says every path that changed between two commits, or that it can't", async () => {
      const { fromSha, toSha, paths } = s.change ?? { fromSha: s.sha, toSha: s.sha, paths: [] };
      const changed = await source.changedPaths(s.repo, fromSha, toSha);
      if (!changed.ok) throw new Error(`changedPaths failed: ${changed.error.message}`);
      expect(s.change !== null).toBe(s.diffs);
      expect(changed.value === null ? null : [...changed.value].sort()).toEqual(
        s.change === null ? null : [...paths].sort(),
      );
    });

    it("answers a refusal as an error, never as an empty commit", async () => {
      const refused = s.source("unauthorized");
      const path = s.files[0]?.path ?? "";
      const read = await refused.readFiles(s.repo, s.sha, [path]);
      expect(read).toMatchObject({ ok: false, error: { kind: "unauthorized" } });
      if (s.lists) {
        const listed = await refused.listFiles(s.repo, s.sha);
        expect(listed).toMatchObject({ ok: false, error: { kind: "unauthorized" } });
      }
      if (s.change !== null) {
        const changed = await refused.changedPaths(s.repo, s.change.fromSha, s.change.toSha);
        expect(changed).toMatchObject({ ok: false, error: { kind: "unauthorized" } });
      }
    });
  });
};
