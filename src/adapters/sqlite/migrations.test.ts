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
      "point_reviews",
      "publications",
      "published_comments",
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
