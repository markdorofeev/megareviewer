import type { Router } from "../http.ts";
import { listAuditEvents } from "./repository.ts";

export const registerAuditRoutes = (router: Router): void => {
  router.get("/audit-log", async (req, res) => {
    const events = await listAuditEvents(req.db, req.accountId);
    res.json({ events });
  });
};
