import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, migrate, schemaVersion } from "./migrations.ts";

/**
 * A database at an earlier schema version, for testing a migration against the data before it.
 * A migration test opens `databaseAt(n - 1)`, inserts rows the old schema allows, migrates to the
 * latest version and checks the rows came through.
 */
const databaseAt = (version: number): DatabaseSync => {
  const db = new DatabaseSync(":memory:");
  migrate(db, MIGRATIONS.slice(0, version));
  return db;
};

const tableNames = (db: DatabaseSync): unknown[] =>
  db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

describe("migrate", () => {
  it("brings a fresh database to the latest version", () => {
    const db = new DatabaseSync(":memory:");

    expect(migrate(db, MIGRATIONS)).toEqual(MIGRATIONS.map((_, index) => index + 1));
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(tableNames(db)).toEqual([
      "analyses",
      "file_contents",
      "guideline_switches",
      "harness_blobs",
      "harness_files",
      "harnesses",
      "known_checkouts",
      "last_model_option",
      "point_reviews",
      "preference_proposals",
      "preferences",
      "publications",
      "published_comments",
      "review_signals",
      "thread_posts",
    ]);
  });

  it("applies nothing to a database that is up to date", () => {
    const db = databaseAt(MIGRATIONS.length);

    expect(migrate(db, MIGRATIONS)).toEqual([]);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it("migrates a version 1 database forward once, keeping its rows", () => {
    const db = databaseAt(1);
    db.exec(`INSERT INTO analyses VALUES
      ('a_0123456789abcdef', 'github', 'acme', 'shop', 1, 'sha', 'v1', 'complete', '{}', 't', 't')`);
    const later = [...MIGRATIONS, "ALTER TABLE analyses ADD COLUMN reviewed_by TEXT"];

    expect(migrate(db, later)).toEqual(
      Array.from({ length: later.length - 1 }, (_, index) => index + 2),
    );
    expect(migrate(db, later)).toEqual([]);
    expect(schemaVersion(db)).toBe(later.length);
    expect(db.prepare("SELECT id, reviewed_by FROM analyses").all()).toEqual([
      { id: "a_0123456789abcdef", reviewed_by: null },
    ]);
  });

  it("turns decision verdicts into point states: approved and pending open, rejected raised", () => {
    const db = databaseAt(2);
    db.exec(`INSERT INTO analyses VALUES
      ('a_0123456789abcdef', 'github', 'acme', 'shop', 1, 'sha', 'v1', 'complete', '{}', 't', 't')`);
    db.exec(`INSERT INTO decision_reviews VALUES
      ('a_0123456789abcdef', 'd1', 'approved', '', 't1'),
      ('a_0123456789abcdef', 'd2', 'rejected', 'No backoff', 't2'),
      ('a_0123456789abcdef', 'd3', 'pending', '', 't3')`);

    migrate(db, MIGRATIONS);

    expect(db.prepare("SELECT * FROM point_reviews ORDER BY point_id").all()).toEqual([
      { analysis_id: "a_0123456789abcdef", point_id: "d1", state: "open", updated_at: "t1" },
      { analysis_id: "a_0123456789abcdef", point_id: "d2", state: "raised", updated_at: "t2" },
      { analysis_id: "a_0123456789abcdef", point_id: "d3", state: "open", updated_at: "t3" },
    ]);
    expect(tableNames(db)).not.toContain("decision_reviews");
  });

  it("numbers an analysis's one publication and its posted comments 1", () => {
    const db = databaseAt(4);
    db.exec(`INSERT INTO analyses VALUES
      ('a_0123456789abcdef', 'github', 'acme', 'shop', 1, 'sha', 'v1', 'complete', '{}', 't', 't'),
      ('a_fedcba9876543210', 'github', 'acme', 'shop', 2, 'sha', 'v1', 'complete', '{}', 't', 't')`);
    db.exec(`INSERT INTO published_comments VALUES
      ('a_0123456789abcdef', 'summary', '101', 't1'),
      ('a_fedcba9876543210', 'summary', '201', 't2')`);
    db.exec(`INSERT INTO publications VALUES ('a_0123456789abcdef', 'https://x/1', 't3', '{}')`);

    migrate(db, MIGRATIONS);

    expect(db.prepare("SELECT * FROM published_comments ORDER BY analysis_id").all()).toEqual([
      {
        analysis_id: "a_0123456789abcdef",
        publication_number: 1,
        comment_key: "summary",
        host_comment_id: "101",
        posted_at: "t1",
      },
      // Posted by a publish that failed part-way: a retry continues publication 1.
      {
        analysis_id: "a_fedcba9876543210",
        publication_number: 1,
        comment_key: "summary",
        host_comment_id: "201",
        posted_at: "t2",
      },
    ]);
    expect(db.prepare("SELECT * FROM publications").all()).toEqual([
      {
        analysis_id: "a_0123456789abcdef",
        number: 1,
        publication_id: null,
        url: "https://x/1",
        published_at: "t3",
        receipt: "{}",
      },
    ]);
  });

  it("adds the preference tables beside the analyses, which keep their rows", () => {
    const db = databaseAt(5);
    db.exec(`INSERT INTO analyses VALUES
      ('a_0123456789abcdef', 'github', 'acme', 'shop', 1, 'sha', 'v1', 'complete', '{}', 't', 't')`);

    expect(migrate(db, MIGRATIONS.slice(0, 6))).toEqual([6]);

    expect(db.prepare("SELECT id FROM analyses").all()).toEqual([{ id: "a_0123456789abcdef" }]);
    db.exec(`INSERT INTO review_signals VALUES
      ('point:a_0123456789abcdef:f1', 'dismissed', 't', 'github', 'acme', 'shop', 1, 'finding',
       'Missing JSDoc', '', NULL)`);
    // A signal outlives its analysis.
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("DELETE FROM analyses");
    expect(db.prepare("SELECT signal_key FROM review_signals").all()).toEqual([
      { signal_key: "point:a_0123456789abcdef:f1" },
    ]);
  });

  it("refuses a preference, a proposal or a signal of a kind it doesn't know", () => {
    const db = databaseAt(MIGRATIONS.length);

    expect(() =>
      db.exec(`INSERT INTO preferences VALUES
        ('pref_1', 'ignore', 'Naming', NULL, NULL, NULL, 'written', 1, 't', 't')`),
    ).toThrow(/CHECK/);
    expect(() =>
      db.exec(`INSERT INTO preference_proposals VALUES
        ('prop_1', 'look-for', 'Naming', NULL, NULL, NULL, 'written', '[]', 'pending', 't')`),
    ).toThrow(/CHECK/);
    expect(() =>
      db.exec(`INSERT INTO review_signals VALUES
        ('k', 'liked', 't', 'github', 'acme', 'shop', 1, NULL, '', '', NULL)`),
    ).toThrow(/CHECK/);
  });

  it("adds the harness tables beside the rest, a harness taking its files with it", () => {
    const db = databaseAt(9);
    db.exec("INSERT INTO guideline_switches VALUES ('github', 'acme', 'shop', 'CLAUDE.md', 1)");
    db.exec("INSERT INTO known_checkouts VALUES ('github', 'acme', 'shop', '/shop', 't')");

    expect(migrate(db, MIGRATIONS.slice(0, 10))).toEqual([10]);

    expect(db.prepare("SELECT path FROM guideline_switches").all()).toEqual([
      { path: "CLAUDE.md" },
    ]);
    expect(db.prepare("SELECT dir FROM known_checkouts").all()).toEqual([{ dir: "/shop" }]);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`INSERT INTO harnesses VALUES
      ('github', 'acme', 'shop', 'sha', 't', NULL, '[]', '[]')`);
    const file = (via: string, position: number) =>
      db.exec(`INSERT INTO harness_files VALUES
        ('github', 'acme', 'shop', 'sha', ${position}, 'CLAUDE.md', 'blob', 1, 1, '${via}', NULL,
         '[]', '[]')`);
    file("root", 0);
    expect(() => file("guess", 1)).toThrow(/CHECK/);
    db.exec("DELETE FROM harnesses");
    expect(db.prepare("SELECT path FROM harness_files").all()).toEqual([]);
  });

  it("drops the harnesses walked before folders were links, and keeps their blobs", () => {
    const db = databaseAt(10);
    db.exec(`INSERT INTO harnesses VALUES
      ('github', 'acme', 'shop', 'sha', 't', NULL, '[]', '[]')`);
    db.exec(`INSERT INTO harness_files VALUES
      ('github', 'acme', 'shop', 'sha', 0, 'CLAUDE.md', 'blob', 1, 1, 'root', NULL, '[]', '[]')`);
    db.exec("INSERT INTO harness_blobs VALUES ('github', 'acme', 'shop', 'blob', 'text', 't')");

    expect(migrate(db, MIGRATIONS.slice(0, 11))).toEqual([11]);

    expect(db.prepare("SELECT sha FROM harnesses").all()).toEqual([]);
    expect(db.prepare("SELECT path FROM harness_files").all()).toEqual([]);
    expect(db.prepare("SELECT blob FROM harness_blobs").all()).toEqual([{ blob: "blob" }]);
  });

  it("rolls back a failed migration and stays at the last good version", () => {
    const db = databaseAt(MIGRATIONS.length);
    const broken = [
      ...MIGRATIONS,
      "CREATE TABLE notes (id TEXT); INSERT INTO no_such_table VALUES (1)",
    ];

    expect(() => migrate(db, broken)).toThrow(/no_such_table/);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(tableNames(db)).not.toContain("notes");
  });

  it("refuses a database from a newer megareviewer", () => {
    const db = databaseAt(MIGRATIONS.length);
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);

    expect(() => migrate(db, MIGRATIONS)).toThrow(/newer than this megareviewer knows/);
  });
});
