import type { Router } from "../http.ts";
import { listComments } from "./repository.ts";

export const registerCommentRoutes = (router: Router): void => {
  router.get("/posts/:id/comments", async (req, res) => {
    res.json({ comments: await listComments(req.db, req.params.id, 50) });
  });
};
