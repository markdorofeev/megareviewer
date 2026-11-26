import { sendError } from "../errors.ts";
import type { Router } from "../http.ts";
import { listMembers, removeMember } from "./repository.ts";

export const registerMemberRoutes = (router: Router): void => {
  router.get("/projects/:id/members", async (req, res) => {
    if (!(await req.can("view", req.params.id))) {
      sendError(res, 404, "project_not_found");
      return;
    }
    res.json({ members: await listMembers(req.db, req.params.id) });
  });

  router.delete("/projects/:id/members/:memberId", async (req, res) => {
    const { id, memberId } = req.params;
    if (!(await req.can("administer", id))) {
      sendError(res, 404, "project_not_found");
      return;
    }
    if (!(await removeMember(req.db, id, memberId))) {
      sendError(res, 404, "member_not_found");
      return;
    }
    res.status(204).end();
  });
};
