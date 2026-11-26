import { sendError } from "../errors.ts";
import type { Router } from "../http.ts";
import { listMembers } from "./repository.ts";

export const registerMemberRoutes = (router: Router): void => {
  router.get("/projects/:id/members", async (req, res) => {
    if (!(await req.can("view", req.params.id))) {
      sendError(res, 404, "project_not_found");
      return;
    }
    res.json({ members: await listMembers(req.db, req.params.id) });
  });
};
