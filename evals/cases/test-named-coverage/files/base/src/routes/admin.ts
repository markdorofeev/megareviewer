import { Router } from "express";
import { requireUser } from "../auth.ts";
import { listAuditEvents } from "../services/audit.ts";

export const adminRouter = Router();

adminRouter.use(requireUser);

adminRouter.get("/admin/audit", async (req, res) => {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json(await listAuditEvents());
});
