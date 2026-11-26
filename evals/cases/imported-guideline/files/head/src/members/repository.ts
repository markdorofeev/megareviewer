import type { Db } from "../db.ts";

export interface Member {
  id: string;
  name: string;
  role: "owner" | "editor" | "viewer";
}

export const listMembers = (db: Db, projectId: string): Promise<Member[]> =>
  db.query<Member>(
    "SELECT id, name, role FROM project_members WHERE project_id = $1 ORDER BY name, id",
    [projectId],
  );

/** Removes a member from a project, and says whether there was one to remove. Owners stay. */
export const removeMember = async (
  db: Db,
  projectId: string,
  memberId: string,
): Promise<boolean> => {
  const removed = await db.query<{ id: string }>(
    `DELETE FROM project_members
     WHERE project_id = $1 AND id = $2 AND role <> 'owner'
     RETURNING id`,
    [projectId, memberId],
  );
  return removed.length > 0;
};
