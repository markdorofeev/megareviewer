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
  // Verdicts on decisions become states of points: an approval said "fine", as open does now,
  // and a rejection raised the decision.
  `
  CREATE TABLE point_reviews (
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    point_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'raised', 'dismissed')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (analysis_id, point_id)
  );
  INSERT INTO point_reviews (analysis_id, point_id, state, updated_at)
    SELECT analysis_id, decision_id, CASE verdict WHEN 'rejected' THEN 'raised' ELSE 'open' END,
      updated_at
    FROM decision_reviews;
  DROP TABLE decision_reviews;
  `,
  // Replies and comments posted at once, for the review activity: a review and its comments are
  // already in publications and published_comments.
  `
  CREATE TABLE thread_posts (
    id INTEGER PRIMARY KEY,
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('reply', 'comment')),
    posted_at TEXT NOT NULL
  );
  CREATE INDEX thread_posts_posted_at ON thread_posts (posted_at);
  `,
  // An analysis can publish several reviews, each numbered from 1, so the comments a review posted
  // are kept per number; the ID the page chose for a review lets a repeated request get its receipt.
  `
  CREATE TABLE published_comments_numbered (
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    publication_number INTEGER NOT NULL CHECK (publication_number > 0),
    comment_key TEXT NOT NULL,
    host_comment_id TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    PRIMARY KEY (analysis_id, publication_number, comment_key)
  );
  INSERT INTO published_comments_numbered
    SELECT analysis_id, 1, comment_key, host_comment_id, posted_at FROM published_comments;
  DROP TABLE published_comments;
  ALTER TABLE published_comments_numbered RENAME TO published_comments;

  CREATE TABLE publications_numbered (
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK (number > 0),
    publication_id TEXT,            -- NULL for reviews published before pages chose one
    url TEXT,
    published_at TEXT NOT NULL,
    receipt TEXT NOT NULL,          -- PublicationReceipt as JSON
    PRIMARY KEY (analysis_id, number)
  );
  INSERT INTO publications_numbered
    SELECT analysis_id, 1, NULL, url, published_at, receipt FROM publications;
  DROP TABLE publications;
  ALTER TABLE publications_numbered RENAME TO publications;
  `,
  // What the reviewer values. None references analyses: a preference is for every pull request,
  // and a signal keeps a point's text after its analysis loses the model run or is gone.
  `
  CREATE TABLE preferences (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('look-for', 'dont-flag')),
    text TEXT NOT NULL,
    host TEXT, owner TEXT, repo TEXT,   -- all NULL: every repository
    source TEXT NOT NULL CHECK (source IN ('written', 'learned', 'imported')),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

  CREATE TABLE preference_proposals (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('look-for', 'dont-flag')),
    text TEXT NOT NULL,
    host TEXT, owner TEXT, repo TEXT,   -- all NULL: every repository
    source TEXT NOT NULL CHECK (source IN ('learned', 'imported')),
    evidence TEXT NOT NULL,             -- a JSON array of lines
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE review_signals (
    signal_key TEXT PRIMARY KEY,        -- what made it, so a retry writes it once
    kind TEXT NOT NULL CHECK (kind IN ('dismissed', 'raised', 'comment')),
    at TEXT NOT NULL,
    host TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL, number INTEGER NOT NULL,
    point_kind TEXT,                    -- NULL for a comment
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    path TEXT
  );
  CREATE INDEX review_signals_at ON review_signals (at);

  CREATE TABLE guideline_switches (
    host TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL,
    path TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    PRIMARY KEY (host, owner, repo, path)
  );

  CREATE TABLE preference_suggestions (
    id INTEGER PRIMARY KEY,
    suggested_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE last_model_option (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    option_id TEXT NOT NULL,
    used_at TEXT NOT NULL
  );
  `,
  // A suggestion reads one repository's signals whenever it's asked for, so nothing counts since.
  `
  DROP TABLE preference_suggestions;
  `,
  // The folders a repository was read from, tried before the home folder is searched.
  `
  CREATE TABLE known_checkouts (
    host TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL,
    dir TEXT NOT NULL,
    last_read_at TEXT NOT NULL,
    PRIMARY KEY (host, owner, repo, dir)
  );
  `,
  // A harness's list per commit, and its files' contents once per blob. Neither references
  // analyses: a harness is for every pull request on its base commit.
  `
  CREATE TABLE harnesses (
    host TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL,
    sha TEXT NOT NULL,
    loaded_at TEXT NOT NULL,
    cut TEXT CHECK (cut IN ('depth', 'files')),   -- NULL: the walk hit no limit
    skipped TEXT NOT NULL,          -- a JSON array of paths with why
    missing TEXT NOT NULL,          -- a JSON array of paths
    PRIMARY KEY (host, owner, repo, sha)
  );

  CREATE TABLE harness_files (
    host TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL,
    sha TEXT NOT NULL,
    position INTEGER NOT NULL,
    path TEXT NOT NULL,
    blob TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    lines INTEGER NOT NULL,
    via TEXT NOT NULL CHECK (via IN ('root', 'import', 'link', 'mention')),
    linked_from TEXT,               -- NULL for a root
    headings TEXT NOT NULL,         -- a JSON array
    links TEXT NOT NULL,            -- a JSON array
    PRIMARY KEY (host, owner, repo, sha, position),
    FOREIGN KEY (host, owner, repo, sha)
      REFERENCES harnesses (host, owner, repo, sha) ON DELETE CASCADE
  );

  CREATE TABLE harness_blobs (
    host TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL,
    blob TEXT NOT NULL,
    content TEXT NOT NULL,
    used_at TEXT NOT NULL,
    PRIMARY KEY (host, owner, repo, blob)
  );
  CREATE INDEX harness_blobs_used_at ON harness_blobs (used_at);
  `,
  // Harnesses walked before folders were links leave out what a folder named holds. The blobs stay,
  // so walking them again reads only the new files.
  `
  DELETE FROM harness_files;
  DELETE FROM harnesses;
  `,
  // Harnesses walked before test data, licenses and folders named outside a root were left out
  // hold those files.
  `
  DELETE FROM harness_files;
  DELETE FROM harnesses;
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
