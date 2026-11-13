import { chmodSync, closeSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type {
  AnalysisStore,
  Clock,
  FileAt,
  FileCache,
  Logger,
} from "../../application/ports/index.ts";
import {
  Analysis,
  type AnalysisId,
  type AnalysisKey,
  CommentKey,
  PointReview,
  PublicationReceipt,
  PullRequestRef,
  type RepoRef,
} from "../../domain/review/index.ts";
import { MIGRATIONS, migrate } from "./migrations.ts";

export interface SqliteAnalysisStoreOptions {
  /** A file path, or ":memory:". */
  readonly path: string;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Fetched files are kept this long, so the cache doesn't grow without bound. */
export const FILE_CACHE_DAYS = 30;

/** The analyses, review state and fetched files, in one database. */
export type SqliteAnalysisStore = AnalysisStore & FileCache & { close(): void };

const PayloadRow = z.object({ id: z.string(), payload: z.string() });
const PointReviewRow = z.object({
  point_id: z.string(),
  state: z.string(),
  updated_at: z.string(),
});
const PostedCommentRow = z.object({ comment_key: z.string(), host_comment_id: z.string() });
const ReceiptRow = z.object({ receipt: z.string() });
const FileRow = z.object({ content: z.string().nullable() });
const RefRow = z.object({
  host: z.string(),
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
});

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The file holds review content of private code, so only its owner may read it. */
const createPrivateFile = (path: string): void => {
  closeSync(openSync(path, "a", 0o600));
  // Also for a file that already existed with a looser mode. SQLite gives the -wal and -shm
  // files it creates the database file's mode.
  chmodSync(path, 0o600);
};

/**
 * An AnalysisStore on Node's built-in SQLite. Rows are parsed on the way out: a row that no
 * longer parses (an analysis from an older schema, say) is logged and treated as absent, because
 * a cache miss is safe and a malformed analysis in the UI isn't.
 */
export const openSqliteAnalysisStore = (
  options: SqliteAnalysisStoreOptions,
): SqliteAnalysisStore => {
  const { clock, logger } = options;
  if (options.path !== ":memory:") createPrivateFile(options.path);

  const db = new DatabaseSync(options.path);
  // Not db.isOpen: it needs Node 22.15, and we run on 22.13.
  let open = true;
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  for (const version of migrate(db, MIGRATIONS)) {
    logger.debug("Applied a database migration", { version });
  }

  const selectById = db.prepare("SELECT id, payload FROM analyses WHERE id = ?");
  const selectByKey = db.prepare(
    `SELECT id, payload FROM analyses
     WHERE host = ? AND owner = ? AND repo = ? AND number = ? AND head_sha = ? AND pipeline_version = ?`,
  );
  const selectRecent = db.prepare(
    "SELECT id, payload FROM analyses ORDER BY updated_at DESC, id LIMIT ?",
  );
  const selectAnalyzedPullRequests = db.prepare(
    `SELECT host, owner, repo, number FROM analyses
     GROUP BY host, owner, repo, number
     ORDER BY MAX(updated_at) DESC, host, owner, repo, number LIMIT ?`,
  );
  // An upsert, not INSERT OR REPLACE: a replace deletes the row and would cascade to its point reviews.
  const upsertAnalysis = db.prepare(
    `INSERT INTO analyses
       (id, host, owner, repo, number, head_sha, pipeline_version, status, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       host = excluded.host, owner = excluded.owner, repo = excluded.repo,
       number = excluded.number, head_sha = excluded.head_sha,
       pipeline_version = excluded.pipeline_version, status = excluded.status,
       payload = excluded.payload, created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
  );
  const selectPointReviews = db.prepare(
    `SELECT point_id, state, updated_at FROM point_reviews
     WHERE analysis_id = ? ORDER BY point_id`,
  );
  const upsertPointReview = db.prepare(
    `INSERT INTO point_reviews (analysis_id, point_id, state, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (analysis_id, point_id) DO UPDATE SET
       state = excluded.state, updated_at = excluded.updated_at`,
  );
  const deletePointReviews = db.prepare("DELETE FROM point_reviews WHERE analysis_id = ?");
  const selectPostedComments = db.prepare(
    "SELECT comment_key, host_comment_id FROM published_comments WHERE analysis_id = ?",
  );
  const upsertPostedComment = db.prepare(
    `INSERT INTO published_comments (analysis_id, comment_key, host_comment_id, posted_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (analysis_id, comment_key) DO UPDATE SET
       host_comment_id = excluded.host_comment_id, posted_at = excluded.posted_at`,
  );
  const selectFile = db.prepare(
    `SELECT content FROM file_contents
     WHERE host = ? AND owner = ? AND repo = ? AND sha = ? AND path = ?`,
  );
  const upsertFile = db.prepare(
    `INSERT INTO file_contents (host, owner, repo, sha, path, content, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (host, owner, repo, sha, path) DO UPDATE SET
       content = excluded.content, fetched_at = excluded.fetched_at`,
  );
  const pruned = db
    .prepare("DELETE FROM file_contents WHERE fetched_at < ?")
    .run(new Date(Date.parse(clock.now()) - FILE_CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString());
  if (Number(pruned.changes) > 0) {
    logger.debug("Dropped old cached files", { count: Number(pruned.changes) });
  }
  const selectPublication = db.prepare("SELECT receipt FROM publications WHERE analysis_id = ?");
  const upsertPublication = db.prepare(
    `INSERT INTO publications (analysis_id, url, published_at, receipt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (analysis_id) DO UPDATE SET
       url = excluded.url, published_at = excluded.published_at, receipt = excluded.receipt`,
  );

  const toAnalysis = (row: unknown): Analysis | null => {
    if (row === undefined) return null;
    const { id, payload } = PayloadRow.parse(row);
    const analysis = Analysis.safeParse(parseJson(payload));
    if (!analysis.success) {
      logger.warn("Ignoring a stored analysis that no longer parses", {
        analysisId: id,
        problem: z.prettifyError(analysis.error),
      });
      return null;
    }
    return analysis.data;
  };

  return {
    async getAnalysis(id: AnalysisId) {
      return toAnalysis(selectById.get(id));
    },

    async findByKey(key: AnalysisKey) {
      const { host, owner, repo } = key.ref.repo;
      return toAnalysis(
        selectByKey.get(host, owner, repo, key.ref.number, key.headSha, key.pipelineVersion),
      );
    },

    async saveAnalysis(analysis: Analysis) {
      const { key } = analysis;
      upsertAnalysis.run(
        analysis.id,
        key.ref.repo.host,
        key.ref.repo.owner,
        key.ref.repo.repo,
        key.ref.number,
        key.headSha,
        key.pipelineVersion,
        analysis.status,
        JSON.stringify(analysis),
        analysis.createdAt,
        analysis.updatedAt,
      );
    },

    async listRecent(limit: number) {
      return selectRecent
        .all(limit)
        .map(toAnalysis)
        .filter((analysis) => analysis !== null);
    },

    async listAnalyzedPullRequests(limit: number) {
      return selectAnalyzedPullRequests.all(limit).flatMap((raw) => {
        const { host, owner, repo, number } = RefRow.parse(raw);
        const ref = PullRequestRef.safeParse({ repo: { host, owner, repo }, number });
        return ref.success ? [ref.data] : [];
      });
    },

    async getPointReviews(id: AnalysisId) {
      return selectPointReviews.all(id).flatMap((raw) => {
        const row = PointReviewRow.parse(raw);
        const review = PointReview.safeParse({
          pointId: row.point_id,
          state: row.state,
          updatedAt: row.updated_at,
        });
        if (review.success) return [review.data];
        logger.warn("Ignoring a stored point review that no longer parses", {
          analysisId: id,
          pointId: row.point_id,
          problem: z.prettifyError(review.error),
        });
        return [];
      });
    },

    async savePointReview(id: AnalysisId, review: PointReview) {
      upsertPointReview.run(id, review.pointId, review.state, review.updatedAt);
    },

    async clearPointReviews(id: AnalysisId) {
      deletePointReviews.run(id);
    },

    async getPostedComments(id: AnalysisId) {
      const posted = new Map<CommentKey, string>();
      for (const raw of selectPostedComments.all(id)) {
        const row = PostedCommentRow.parse(raw);
        const key = CommentKey.safeParse(row.comment_key);
        if (key.success && row.host_comment_id !== "") {
          posted.set(key.data, row.host_comment_id);
        } else {
          logger.warn("Ignoring a stored posted comment that no longer parses", {
            analysisId: id,
            commentKey: row.comment_key,
          });
        }
      }
      return posted;
    },

    async recordPostedComment(id: AnalysisId, key: CommentKey, hostCommentId: string) {
      upsertPostedComment.run(id, key, hostCommentId, clock.now());
    },

    async getPublication(id: AnalysisId) {
      const row = selectPublication.get(id);
      if (row === undefined) return null;
      const receipt = PublicationReceipt.safeParse(parseJson(ReceiptRow.parse(row).receipt));
      if (receipt.success) return receipt.data;
      logger.warn("Ignoring a stored publication that no longer parses", {
        analysisId: id,
        problem: z.prettifyError(receipt.error),
      });
      return null;
    },

    async recordPublication(id: AnalysisId, receipt: PublicationReceipt) {
      upsertPublication.run(id, receipt.url, receipt.publishedAt, JSON.stringify(receipt));
    },

    async get(repo: RepoRef, { sha, path }: FileAt) {
      const row = selectFile.get(repo.host, repo.owner, repo.repo, sha, path);
      return row === undefined ? null : { content: FileRow.parse(row).content };
    },

    async put(repo: RepoRef, { sha, path }: FileAt, content: string | null) {
      upsertFile.run(repo.host, repo.owner, repo.repo, sha, path, content, clock.now());
    },

    close() {
      if (!open) return;
      db.close();
      open = false;
    },
  };
};
