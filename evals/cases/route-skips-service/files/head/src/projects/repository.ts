import type { Database } from "../database.ts";

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly archivedAt: Date | null;
}

const COLUMNS = `id, name, archived_at AS "archivedAt"`;

/** The only code that writes SQL for projects. */
export const createProjectRepository = (database: Database) => ({
  async find(id: string, ownerId: string): Promise<Project | null> {
    const { rows } = await database.query(
      `SELECT ${COLUMNS} FROM projects WHERE id = $1 AND owner_id = $2`,
      [id, ownerId],
    );
    return rows[0] ?? null;
  },

  async setArchivedAt(id: string, ownerId: string, at: Date | null): Promise<Project | null> {
    const { rows } = await database.query(
      `UPDATE projects SET archived_at = $3 WHERE id = $1 AND owner_id = $2 RETURNING ${COLUMNS}`,
      [id, ownerId, at],
    );
    return rows[0] ?? null;
  },
});

export type ProjectRepository = ReturnType<typeof createProjectRepository>;
