import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Clock, KnownCheckouts } from "../../application/ports/index.ts";
import { RepoRef, Timestamp } from "../../domain/review/index.ts";

const DirRow = z.object({ dir: z.string() });
const KnownRow = z.object({
  host: z.string(),
  owner: z.string(),
  repo: z.string(),
  dir: z.string(),
  last_read_at: z.string(),
});

const KnownRepo = z.object({ repo: RepoRef, lastReadAt: Timestamp });

export const createSqliteKnownCheckouts = (db: DatabaseSync, clock: Clock): KnownCheckouts => {
  const selectDirs = db.prepare(
    `SELECT dir FROM known_checkouts WHERE host = ? AND owner = ? AND repo = ?
     ORDER BY last_read_at DESC, dir`,
  );
  const upsert = db.prepare(
    `INSERT INTO known_checkouts (host, owner, repo, dir, last_read_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (host, owner, repo, dir) DO UPDATE SET last_read_at = excluded.last_read_at`,
  );
  const remove = db.prepare(
    "DELETE FROM known_checkouts WHERE host = ? AND owner = ? AND repo = ? AND dir = ?",
  );
  const selectAll = db.prepare(
    "SELECT host, owner, repo, dir, last_read_at FROM known_checkouts ORDER BY last_read_at DESC, dir",
  );

  return {
    async foldersRead({ host, owner, repo }: RepoRef) {
      return selectDirs.all(host, owner, repo).map((row) => DirRow.parse(row).dir);
    },

    async rememberFolder({ host, owner, repo }: RepoRef, dir: string) {
      upsert.run(host, owner, repo, dir, clock.now());
    },

    async forgetFolder({ host, owner, repo }: RepoRef, dir: string) {
      remove.run(host, owner, repo, dir);
    },

    async knownCheckouts() {
      return selectAll.all().flatMap((raw) => {
        const { host, owner, repo, dir, last_read_at } = KnownRow.parse(raw);
        const known = KnownRepo.safeParse({
          repo: { host, owner, repo },
          lastReadAt: last_read_at,
        });
        return known.success ? [{ ...known.data, dir }] : [];
      });
    },
  };
};
