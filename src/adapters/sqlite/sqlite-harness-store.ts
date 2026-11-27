import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Clock, HarnessBlob, HarnessStore, Logger } from "../../application/ports/index.ts";
import {
  type BlobHash,
  HARNESS_RULES,
  Harness,
  type RepoRef,
  type Timestamp,
} from "../../domain/review/index.ts";

const HarnessRow = z.object({
  sha: z.string(),
  cut: z.string().nullable(),
  skipped: z.string(),
  missing: z.string(),
});
const FileRow = z.object({
  path: z.string(),
  blob: z.string(),
  bytes: z.number(),
  lines: z.number(),
  via: z.string(),
  linked_from: z.string().nullable(),
  headings: z.string(),
  links: z.string(),
});
const BlobRow = z.object({ content: z.string() });

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const columns = ({ host, owner, repo }: RepoRef): [string, string, string] => [host, owner, repo];

/**
 * A HarnessStore on the analyses' database. A harness with a row that no longer parses is logged
 * and treated as absent: loading it again is safe, and a list with a file missing isn't. What
 * wasn't used since `keptSince` is dropped at once.
 */
export const createSqliteHarnessStore = (
  db: DatabaseSync,
  options: { readonly clock: Clock; readonly logger: Logger; readonly keptSince: Timestamp },
): HarnessStore => {
  const { clock, logger } = options;
  const selectHarness = db.prepare(
    `SELECT sha, cut, skipped, missing FROM harnesses
     WHERE host = ? AND owner = ? AND repo = ? AND sha = ? AND rules = ?`,
  );
  const selectLatest = db.prepare(
    `SELECT sha, cut, skipped, missing FROM harnesses
     WHERE host = ? AND owner = ? AND repo = ? AND rules = ?
     ORDER BY julianday(loaded_at) DESC, rowid DESC LIMIT 1`,
  );
  const selectFiles = db.prepare(
    `SELECT path, blob, bytes, lines, via, linked_from, headings, links FROM harness_files
     WHERE host = ? AND owner = ? AND repo = ? AND sha = ? ORDER BY position`,
  );
  // Deletes its files with it, and a new row is the last, so the latest at one time is the last put.
  const deleteHarness = db.prepare(
    "DELETE FROM harnesses WHERE host = ? AND owner = ? AND repo = ? AND sha = ?",
  );
  const insertHarness = db.prepare(
    `INSERT INTO harnesses (host, owner, repo, sha, loaded_at, cut, skipped, missing, rules)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFile = db.prepare(
    `INSERT INTO harness_files
       (host, owner, repo, sha, position, path, blob, bytes, lines, via, linked_from, headings, links)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const useBlob = db.prepare(
    `UPDATE harness_blobs SET used_at = ? WHERE host = ? AND owner = ? AND repo = ? AND blob = ?
     RETURNING content`,
  );
  const upsertBlob = db.prepare(
    `INSERT INTO harness_blobs (host, owner, repo, blob, content, used_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (host, owner, repo, blob) DO UPDATE SET
       content = excluded.content, used_at = excluded.used_at`,
  );
  const dropBlobs = db.prepare("DELETE FROM harness_blobs WHERE julianday(used_at) < julianday(?)");
  // Older rules only: a megareviewer of newer ones can share the database.
  const dropHarnesses = db.prepare(
    "DELETE FROM harnesses WHERE julianday(loaded_at) < julianday(?) OR rules < ?",
  );

  const atomically = (work: () => void): void => {
    db.exec("BEGIN IMMEDIATE");
    try {
      work();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const toHarness = (repo: RepoRef, raw: unknown): Harness | null => {
    if (raw === undefined) return null;
    const row = HarnessRow.parse(raw);
    const harness = Harness.safeParse({
      baseSha: row.sha,
      files: selectFiles.all(...columns(repo), row.sha).map((rawFile) => {
        const { linked_from: linkedFrom, headings, links, ...file } = FileRow.parse(rawFile);
        return { ...file, linkedFrom, headings: parseJson(headings), links: parseJson(links) };
      }),
      cut: row.cut,
      skipped: parseJson(row.skipped),
      missing: parseJson(row.missing),
    });
    if (harness.success) return harness.data;
    logger.warn("Ignoring a stored harness that no longer parses", {
      repo,
      sha: row.sha,
      problem: z.prettifyError(harness.error),
    });
    return null;
  };

  const drop = (time: Timestamp): void => {
    const blobs = Number(dropBlobs.run(time).changes);
    const harnesses = Number(dropHarnesses.run(time, HARNESS_RULES).changes);
    if (blobs + harnesses > 0) logger.debug("Dropped old harnesses", { blobs, harnesses });
  };
  drop(options.keptSince);

  return {
    async getHarness(repo: RepoRef, sha: string) {
      return toHarness(repo, selectHarness.get(...columns(repo), sha, HARNESS_RULES));
    },

    async putHarness(repo: RepoRef, harness: Harness) {
      const at = [...columns(repo), harness.baseSha] as const;
      atomically(() => {
        deleteHarness.run(...at);
        insertHarness.run(
          ...at,
          clock.now(),
          harness.cut,
          JSON.stringify(harness.skipped),
          JSON.stringify(harness.missing),
          HARNESS_RULES,
        );
        for (const [position, file] of harness.files.entries()) {
          insertFile.run(
            ...at,
            position,
            file.path,
            file.blob,
            file.bytes,
            file.lines,
            file.via,
            file.linkedFrom,
            JSON.stringify(file.headings),
            JSON.stringify(file.links),
          );
        }
      });
    },

    async latestHarness(repo: RepoRef) {
      return toHarness(repo, selectLatest.get(...columns(repo), HARNESS_RULES));
    },

    async getBlobs(repo: RepoRef, blobs: readonly BlobHash[]) {
      const found = new Map<BlobHash, string>();
      atomically(() => {
        for (const blob of blobs) {
          const row = useBlob.get(clock.now(), ...columns(repo), blob);
          if (row !== undefined) found.set(blob, BlobRow.parse(row).content);
        }
      });
      return found;
    },

    async putBlobs(repo: RepoRef, entries: readonly HarnessBlob[]) {
      atomically(() => {
        for (const { blob, content } of entries) {
          upsertBlob.run(...columns(repo), blob, content, clock.now());
        }
      });
    },

    async dropUnusedSince(time: Timestamp) {
      drop(time);
    },
  };
};
