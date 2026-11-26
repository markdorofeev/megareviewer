import express from "express";
import type { Database } from "./database.ts";
import { createProjectRepository } from "./projects/repository.ts";
import { projectRoutes } from "./projects/routes.ts";
import { createProjectService } from "./projects/service.ts";
import { requireUser } from "./require-user.ts";

export const createApp = (database: Database) => {
  const app = express();
  const projects = createProjectService(createProjectRepository(database));
  app.use(requireUser, projectRoutes(projects));
  return app;
};
