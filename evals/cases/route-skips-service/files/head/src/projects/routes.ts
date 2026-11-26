import { Router } from "express";
import type { Database } from "../database.ts";
import type { ProjectService } from "./service.ts";

export const projectRoutes = (projects: ProjectService, database: Database): Router => {
  const router = Router();

  router.get("/projects/:id", async (request, response) => {
    const project = await projects.get(request.params.id, request.userId);
    if (project === null) return response.status(404).json({ error: "project_not_found" });
    return response.json(project);
  });

  router.post("/projects/:id/archive", async (request, response) => {
    const project = await projects.archive(request.params.id, request.userId);
    if (project === null) return response.status(404).json({ error: "project_not_found" });
    return response.json(project);
  });

  router.post("/projects/:id/restore", async (request, response) => {
    const { rows } = await database.query(
      `UPDATE projects SET archived_at = NULL
       WHERE id = $1 AND owner_id = $2
       RETURNING id, name, archived_at AS "archivedAt"`,
      [request.params.id, request.userId],
    );
    const project = rows[0] ?? null;
    if (project === null) return response.status(404).json({ error: "project_not_found" });
    return response.json(project);
  });

  return router;
};
