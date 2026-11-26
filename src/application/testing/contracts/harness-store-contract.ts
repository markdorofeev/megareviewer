import { beforeEach, describe, expect, it } from "vitest";
import { BlobHash, type Harness, type RepoRef } from "../../../domain/review/index.ts";
import type { Clock, HarnessStore } from "../../ports/index.ts";
import { FixedClock } from "../fixed-clock.ts";

const repo: RepoRef = { host: "github", owner: "acme", repo: "shop" };
const otherRepos: readonly RepoRef[] = [
  { ...repo, host: "bitbucket" },
  { ...repo, owner: "other" },
  { ...repo, repo: "other" },
];

const blob = (digit: string): BlobHash => BlobHash.parse(digit.repeat(40));
const DAY_MS = 24 * 60 * 60 * 1000;

const harness = (sha: string, overrides: Partial<Harness> = {}): Harness => ({
  baseSha: sha.repeat(40),
  files: [
    {
      path: "CLAUDE.md",
      blob: blob("a"),
      bytes: 310,
      lines: 13,
      via: "root",
      linkedFrom: null,
      headings: [{ level: 1, text: "megareviewer", line: 1 }],
      links: [{ path: "docs/rules.md", kind: "import" }],
    },
    {
      path: "docs/rules.md",
      blob: blob("b"),
      bytes: 2048,
      lines: 40,
      via: "import",
      linkedFrom: "CLAUDE.md",
      headings: [
        { level: 2, text: 'Naming: "quotes" and ünïcödé', line: 3 },
        { level: 3, text: "Tests", line: 9 },
      ],
      links: [],
    },
  ],
  cut: null,
  skipped: [],
  missing: ["AGENTS.md", "docs/docs/rules.md"],
  ...overrides,
});

export const describeHarnessStoreContract = (
  name: string,
  setup: (clock: Clock) => HarnessStore,
): void => {
  describe(`HarnessStore contract: ${name}`, () => {
    let clock: FixedClock;
    let store: HarnessStore;
    beforeEach(() => {
      clock = new FixedClock("2026-11-01T10:00:00.000Z");
      store = setup(clock);
    });

    it("starts empty", async () => {
      expect(await store.getHarness(repo, "1".repeat(40))).toBeNull();
      expect(await store.latestHarness(repo)).toBeNull();
      expect(await store.getBlobs(repo, [blob("a")])).toEqual(new Map());
    });

    it("returns a harness as it was put, files in order", async () => {
      const cut = harness("2", {
        cut: "depth",
        skipped: [
          { path: "docs/huge.md", reason: "too-large" },
          { path: "docs/link.md", reason: "unreadable" },
        ],
      });
      const empty = harness("3", { files: [], cut: "files", missing: [] });
      for (const one of [harness("1"), cut, empty]) {
        await store.putHarness(repo, one);
        expect(await store.getHarness(repo, one.baseSha)).toEqual(one);
      }
    });

    it("keeps a commit's latest, with none of the files of the one before", async () => {
      const [first] = harness("1").files;
      await store.putHarness(repo, harness("1"));
      const replaced = harness("1", { files: first === undefined ? [] : [first] });
      await store.putHarness(repo, replaced);
      expect(await store.getHarness(repo, replaced.baseSha)).toEqual(replaced);
    });

    it("knows the harness put last, a commit's put again among them", async () => {
      await store.putHarness(repo, harness("1"));
      await store.putHarness(repo, harness("2"));
      expect(await store.latestHarness(repo)).toEqual(harness("2"));
      clock.advance(1000);
      await store.putHarness(repo, harness("1"));
      expect(await store.latestHarness(repo)).toEqual(harness("1"));
    });

    it("gives the blobs it has, and leaves out the ones it doesn't", async () => {
      await store.putBlobs(repo, [
        { blob: blob("a"), content: "# Rules\n\nünïcödé ✓\n" },
        { blob: blob("b"), content: "" },
      ]);
      expect(await store.getBlobs(repo, [blob("b"), blob("c"), blob("a")])).toEqual(
        new Map([
          [blob("a"), "# Rules\n\nünïcödé ✓\n"],
          [blob("b"), ""],
        ]),
      );
      expect(await store.getBlobs(repo, [])).toEqual(new Map());
    });

    it("takes a blob put again, and no blobs at all", async () => {
      await store.putBlobs(repo, [{ blob: blob("a"), content: "A" }]);
      await store.putBlobs(repo, [{ blob: blob("a"), content: "A" }]);
      await store.putBlobs(repo, []);
      expect(await store.getBlobs(repo, [blob("a")])).toEqual(new Map([[blob("a"), "A"]]));
    });

    it("keeps repositories apart", async () => {
      await store.putHarness(repo, harness("1"));
      await store.putBlobs(repo, [{ blob: blob("a"), content: "A" }]);
      for (const other of otherRepos) {
        expect(await store.getHarness(other, "1".repeat(40))).toBeNull();
        expect(await store.latestHarness(other)).toBeNull();
        expect(await store.getBlobs(other, [blob("a")])).toEqual(new Map());
      }
    });

    it("drops the blobs not used since a time, where reading one is using it", async () => {
      await store.putBlobs(repo, [
        { blob: blob("a"), content: "A" },
        { blob: blob("b"), content: "B" },
        { blob: blob("c"), content: "C" },
      ]);
      clock.advance(DAY_MS);
      await store.getBlobs(repo, [blob("a")]);
      await store.putBlobs(repo, [{ blob: blob("b"), content: "B" }]);
      await store.dropUnusedSince(clock.now());
      expect(await store.getBlobs(repo, [blob("a"), blob("b"), blob("c")])).toEqual(
        new Map([
          [blob("a"), "A"],
          [blob("b"), "B"],
        ]),
      );
    });

    it("drops the harnesses put before a time", async () => {
      await store.putHarness(repo, harness("1"));
      clock.advance(DAY_MS);
      await store.putHarness(repo, harness("2"));
      await store.dropUnusedSince(clock.now());
      expect(await store.getHarness(repo, "1".repeat(40))).toBeNull();
      expect(await store.getHarness(repo, "2".repeat(40))).toEqual(harness("2"));
    });
  });
};
