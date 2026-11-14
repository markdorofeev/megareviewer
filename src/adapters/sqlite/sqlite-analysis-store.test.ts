import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  describeAnalysisStoreContract,
  describeFileCacheContract,
  FixedClock,
  RecordingLogger,
  smallFeatureAnalysis,
} from "../../application/testing/index.ts";
import {
  CommentKey,
  PointId,
  type PointReview,
  type PublicationReceipt,
} from "../../domain/review/index.ts";
import { openSqliteAnalysisStore, type SqliteAnalysisStore } from "./index.ts";
import { MIGRATIONS } from "./migrations.ts";

const root = mkdtempSync(join(tmpdir(), "megareviewer-sqlite-"));
let tempCount = 0;
const tempPath = (): string => {
  tempCount += 1;
  return join(root, `db-${tempCount}.sqlite`);
};

const open: SqliteAnalysisStore[] = [];
const openStore = (
  path: string,
  logger = new RecordingLogger(),
  clock = new FixedClock(),
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

/** Changes the file behind the store's back, like an older megareviewer or a test-only delete. */
const withRawDatabase = (path: string, change: (db: DatabaseSync) => void): void => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  change(db);
  db.close();
};

const warnings = (logger: RecordingLogger) =>
  logger.entries.filter((entry) => entry.level === "warn");

const analysis = smallFeatureAnalysis;
const raised: PointReview = {
  pointId: PointId.parse("d1"),
  state: "raised",
  updatedAt: "2026-10-21T10:05:00Z",
};
const summaryKey = CommentKey.parse("summary");
const receipt: PublicationReceipt = {
  url: null,
  publishedAt: "2026-10-21T10:10:00Z",
  postedCommentIds: {},
};

describeAnalysisStoreContract("sqlite-memory", (clock) =>
  openStore(":memory:", new RecordingLogger(), clock),
);
describeAnalysisStoreContract("sqlite-file", (clock) =>
  openStore(tempPath(), new RecordingLogger(), clock),
);
describeFileCacheContract("sqlite-memory", () => openStore(":memory:"));
describeFileCacheContract("sqlite-file", () => openStore(tempPath()));

describe("the file cache", () => {
  const repo = { host: "github", owner: "acme", repo: "shop" } as const;
  const file = { sha: "a".repeat(40), path: "a.ts" };
  const DAY = 24 * 60 * 60 * 1000;

  it("keeps files across reopening", async () => {
    const path = tempPath();
    await openStore(path).put(repo, file, "kept");
    expect(await openStore(path).get(repo, file)).toEqual({ content: "kept" });
  });

  it("drops files fetched more than 30 days before it opens", async () => {
    const path = tempPath();
    const clock = new FixedClock();
    const store = openStore(path, new RecordingLogger(), clock);
    await store.put(repo, file, "old");
    clock.advance(10 * DAY);
    await store.put(repo, { ...file, path: "b.ts" }, "newer");
    store.close();

    clock.advance(21 * DAY);
    const reopened = openStore(path, new RecordingLogger(), clock);
    expect(await reopened.get(repo, file)).toBeNull();
    expect(await reopened.get(repo, { ...file, path: "b.ts" })).toEqual({ content: "newer" });
  });
});

describe("openSqliteAnalysisStore", () => {
  it("keeps data across reopening without re-running migrations", async () => {
    const path = tempPath();
    const first = openStore(path);
    await first.saveAnalysis(analysis);
    first.close();

    const logger = new RecordingLogger();
    const second = openStore(path, logger);

    expect(await second.getAnalysis(analysis.id)).toEqual(analysis);
    expect(logger.entries).toEqual([]);
    withRawDatabase(path, (db) => {
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    });
  });

  it("logs the migrations it applies to a new database", () => {
    const logger = new RecordingLogger();
    openStore(":memory:", logger);

    expect(logger.entries).toEqual(
      MIGRATIONS.map((_, index) => ({
        level: "debug",
        message: "Applied a database migration",
        fields: { version: index + 1 },
      })),
    );
  });

  it("uses WAL", () => {
    const path = tempPath();
    openStore(path);

    withRawDatabase(path, (db) => {
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    });
  });

  it.skipIf(process.platform === "win32")("creates the file readable by its owner only", () => {
    const path = tempPath();
    openStore(path);

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("tightens the mode of an existing file", () => {
    const path = tempPath();
    writeFileSync(path, "");
    chmodSync(path, 0o644);
    openStore(path);

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("treats an analysis that no longer parses as absent, and logs it", async () => {
    const path = tempPath();
    const logger = new RecordingLogger();
    const store = openStore(path, logger);
    await store.saveAnalysis(analysis);
    withRawDatabase(path, (db) => {
      db.prepare("UPDATE analyses SET payload = ? WHERE id = ?").run(
        JSON.stringify({ ...analysis, status: "queued" }),
        analysis.id,
      );
    });

    expect(await store.getAnalysis(analysis.id)).toBeNull();
    expect(await store.findByKey(analysis.key)).toBeNull();
    expect(await store.listRecent(10)).toEqual([]);
    expect(warnings(logger)).toHaveLength(3);
    expect(warnings(logger)[0]).toMatchObject({
      level: "warn",
      message: "Ignoring a stored analysis that no longer parses",
      fields: { analysisId: analysis.id, problem: expect.stringContaining("status") },
    });
  });

  it("treats a payload that isn't JSON as absent", async () => {
    const path = tempPath();
    const logger = new RecordingLogger();
    const store = openStore(path, logger);
    await store.saveAnalysis(analysis);
    withRawDatabase(path, (db) => {
      db.prepare("UPDATE analyses SET payload = '{not json' WHERE id = ?").run(analysis.id);
    });

    expect(await store.getAnalysis(analysis.id)).toBeNull();
    expect(warnings(logger)).toHaveLength(1);
  });

  it("skips point reviews, posted comments and publications that no longer parse, and logs them", async () => {
    const path = tempPath();
    const logger = new RecordingLogger();
    const store = openStore(path, logger);
    await store.saveAnalysis(analysis);
    await store.savePointReview(analysis.id, raised);
    await store.recordPostedComment(analysis.id, summaryKey, "101");
    await store.recordPublication(analysis.id, receipt);
    withRawDatabase(path, (db) => {
      db.prepare("INSERT INTO point_reviews VALUES (?, 'x1', 'raised', ?)").run(
        analysis.id,
        raised.updatedAt,
      );
      db.prepare("INSERT INTO published_comments VALUES (?, 'hunk:h1', '102', ?)").run(
        analysis.id,
        raised.updatedAt,
      );
      db.prepare("UPDATE publications SET receipt = '{}' WHERE analysis_id = ?").run(analysis.id);
    });

    expect(await store.getPointReviews(analysis.id)).toEqual([raised]);
    expect(Object.fromEntries(await store.getPostedComments(analysis.id))).toEqual({
      summary: "101",
    });
    expect(await store.getPublication(analysis.id)).toBeNull();
    expect(warnings(logger).map((entry) => entry.message)).toEqual([
      "Ignoring a stored point review that no longer parses",
      "Ignoring a stored posted comment that no longer parses",
      "Ignoring a stored publication that no longer parses",
    ]);
  });

  it("keeps point reviews, comments and the publication when an analysis is saved again", async () => {
    const store = openStore(":memory:");
    await store.saveAnalysis({ ...analysis, status: "running" });
    await store.savePointReview(analysis.id, raised);
    await store.recordPostedComment(analysis.id, summaryKey, "101");
    await store.recordPublication(analysis.id, receipt);
    await store.saveAnalysis(analysis);

    expect(await store.getPointReviews(analysis.id)).toEqual([raised]);
    expect([...(await store.getPostedComments(analysis.id))]).toEqual([["summary", "101"]]);
    expect(await store.getPublication(analysis.id)).toEqual(receipt);
  });

  it("deletes an analysis's point reviews, comments and publication with it", async () => {
    const path = tempPath();
    const store = openStore(path);
    await store.saveAnalysis(analysis);
    await store.savePointReview(analysis.id, raised);
    await store.recordPostedComment(analysis.id, summaryKey, "101");
    await store.recordPublication(analysis.id, receipt);

    withRawDatabase(path, (db) => {
      db.prepare("DELETE FROM analyses WHERE id = ?").run(analysis.id);
      for (const table of ["point_reviews", "published_comments", "publications"]) {
        expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
      }
    });
  });

  it("refuses a point review for an analysis it doesn't have", async () => {
    const store = openStore(":memory:");

    await expect(store.savePointReview(analysis.id, raised)).rejects.toThrow(/FOREIGN KEY/);
  });
});
