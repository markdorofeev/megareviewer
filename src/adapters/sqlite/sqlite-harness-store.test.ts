import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { Clock } from "../../application/ports/index.ts";
import {
  describeHarnessStoreContract,
  FixedClock,
  RecordingLogger,
} from "../../application/testing/index.ts";
import { BlobHash, type Harness, type RepoRef } from "../../domain/review/index.ts";
import { openSqliteAnalysisStore, type SqliteAnalysisStore } from "./index.ts";
import { FILE_CACHE_DAYS } from "./sqlite-analysis-store.ts";

const root = mkdtempSync(join(tmpdir(), "megareviewer-harness-"));
let tempCount = 0;
const tempPath = (): string => {
  tempCount += 1;
  return join(root, `db-${tempCount}.sqlite`);
};

const open: SqliteAnalysisStore[] = [];
const openStore = (
  path: string,
  clock: Clock = new FixedClock(),
  logger = new RecordingLogger(),
): SqliteAnalysisStore => {
  const store = openSqliteAnalysisStore({ path, clock, logger });
  open.push(store);
  return store;
};

afterEach(() => {
  for (const store of open.splice(0)) store.close();
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describeHarnessStoreContract("sqlite-memory", (clock) => openStore(":memory:", clock));
describeHarnessStoreContract("sqlite-file", (clock) => openStore(tempPath(), clock));

const repo: RepoRef = { host: "github", owner: "acme", repo: "shop" };
const blob = BlobHash.parse("a".repeat(40));
const harness: Harness = {
  baseSha: "b".repeat(40),
  files: [
    {
      path: "CLAUDE.md",
      blob,
      bytes: 6,
      lines: 1,
      via: "root",
      linkedFrom: null,
      headings: [{ level: 1, text: "Shop", line: 1 }],
      links: [],
    },
  ],
  cut: null,
  skipped: [],
  missing: [],
};

const DAY_MS = 24 * 60 * 60 * 1000;

describe("the SQLite harness store", () => {
  it("keeps what it holds across a restart, and drops what wasn't used for 30 days at one", async () => {
    const path = tempPath();
    const clock = new FixedClock("2026-11-01T10:00:00.000Z");
    const first = openStore(path, clock);
    await first.putHarness(repo, harness);
    await first.putBlobs(repo, [{ blob, content: "# Shop" }]);
    first.close();

    clock.advance((FILE_CACHE_DAYS - 1) * DAY_MS);
    const second = openStore(path, clock);
    expect(await second.getHarness(repo, harness.baseSha)).toEqual(harness);
    expect(await second.getBlobs(repo, [blob])).toEqual(new Map([[blob, "# Shop"]]));
    second.close();

    clock.advance(2 * DAY_MS);
    const third = openStore(path, clock);
    expect(await third.getHarness(repo, harness.baseSha)).toBeNull();
    expect(await third.getBlobs(repo, [blob])).toEqual(new Map([[blob, "# Shop"]]));
    third.close();

    clock.advance((FILE_CACHE_DAYS + 1) * DAY_MS);
    expect(await openStore(path, clock).getBlobs(repo, [blob])).toEqual(new Map());
  });

  it("treats a harness that no longer parses as absent, and logs it", async () => {
    const path = tempPath();
    const logger = new RecordingLogger();
    const store = openStore(path, new FixedClock(), logger);
    await store.putHarness(repo, harness);
    const db = new DatabaseSync(path);
    db.exec("UPDATE harness_files SET headings = 'not json'");
    db.close();

    expect(await store.getHarness(repo, harness.baseSha)).toBeNull();
    expect(await store.latestHarness(repo)).toBeNull();
    expect(logger.entries.find((entry) => entry.level === "warn")?.message).toBe(
      "Ignoring a stored harness that no longer parses",
    );
  });

  it("leaves a harness as it was when the one replacing it can't be written", async () => {
    const path = tempPath();
    const store = openStore(path);
    await store.putHarness(repo, harness);
    const db = new DatabaseSync(path);
    db.exec(`CREATE TRIGGER no_files BEFORE INSERT ON harness_files
      BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    db.close();

    await expect(store.putHarness(repo, { ...harness, cut: "files" })).rejects.toThrow("disk full");
    expect(await store.getHarness(repo, harness.baseSha)).toEqual(harness);
  });
});
