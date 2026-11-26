import type { Project, ProjectRepository } from "./repository.ts";

/** What can be done with a project. Routes and jobs go through it, never to the repository. */
export const createProjectService = (repository: ProjectRepository) => ({
  get: (id: string, ownerId: string): Promise<Project | null> => repository.find(id, ownerId),
  archive: (id: string, ownerId: string): Promise<Project | null> =>
    repository.setArchivedAt(id, ownerId, new Date()),
});

export type ProjectService = ReturnType<typeof createProjectService>;
