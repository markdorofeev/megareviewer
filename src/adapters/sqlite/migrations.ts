import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

/**
 * The schema, one migration per entry, in order. Never edit an applied migration: add a new one.
 * `PRAGMA user_version` holds how many have been applied.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE analyses (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL, number INTEGER NOT NULL,
    head_sha TEXT NOT NULL, pipeline_version TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,          -- the full Analysis as JSON
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE (host, owner, repo, number, head_sha, pipeline_version)
  );
  CREATE INDEX analyses_updated_at ON analyses (updated_at DESC);

  CREATE TABLE decision_reviews (
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    decision_id TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('pending', 'approved', 'rejected')),
    comment TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (analysis_id, decision_id)
  );

  CREATE TABLE published_comments (
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    comment_key TEXT NOT NULL,
    host_comment_id TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    PRIMARY KEY (analysis_id, comment_key)
  );

  CREATE TABLE publications (
    analysis_id TEXT PRIMARY KEY REFERENCES analyses(id) ON DELETE CASCADE,
    url TEXT,
    published_at TEXT NOT NULL,
    receipt TEXT NOT NULL           -- PublicationReceipt as JSON
  );
  `,
  `
  CREATE TABLE file_contents (
    host TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL,
    sha TEXT NOT NULL, path TEXT NOT NULL,
    content TEXT,                   -- NULL: the file isn't at this commit
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (host, owner, repo, sha, path)
  );
  CREATE INDEX file_contents_fetched_at ON file_contents (fetched_at);
  `,
];

const UserVersion = z.object({ user_version: z.number().int().nonnegative() });

export const schemaVersion = (db: DatabaseSync): number =>
  UserVersion.parse(db.prepare("PRAGMA user_version").get()).user_version;

/**
 * Applies the migrations the database doesn't have yet, each in its own transaction with the
 * version bump, so a failed migration leaves the database at the last good version.
 * Returns the versions it applied.
 */
export const migrate = (db: DatabaseSync, migrations: readonly string[]): number[] => {
  const current = schemaVersion(db);
  if (current > migrations.length) {
    // Running older code on a newer schema could write rows the newer code misreads.
    throw new Error(
      `The database is at schema version ${current}, newer than this megareviewer knows ` +
        `(${migrations.length}). Upgrade megareviewer.`,
    );
  }
  const applied: number[] = [];
  for (const [index, sql] of migrations.entries()) {
    const version = index + 1;
    if (version <= current) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      // Another process opening the same file may have applied it while this one waited.
      if (schemaVersion(db) >= version) {
        db.exec("COMMIT");
        continue;
      }
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    applied.push(version);
  }
  return applied;
};
