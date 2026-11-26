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
