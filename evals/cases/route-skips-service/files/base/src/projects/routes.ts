import { Router } from "express";
import type { ProjectService } from "./service.ts";

export const projectRoutes = (projects: ProjectService): Router => {
  const router = Router();

  router.get("/projects/:id", async (request, response) => {
    const project = await projects.get(request.params.id, request.userId);
    if (project === null) return response.status(404).json({ error: "project_not_found" });
    return response.json(project);
  });

  return router;
};
