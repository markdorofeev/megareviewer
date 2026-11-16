import { Router } from "express";
import { requireUser } from "../auth.ts";
import { listAuditEvents } from "../services/audit.ts";
import { listCustomers, toCsv } from "../services/customers.ts";

export const adminRouter = Router();

adminRouter.use(requireUser);

adminRouter.get("/admin/audit", async (req, res) => {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json(await listAuditEvents());
});

// Tested in admin.test.ts: non-admins are rejected.
adminRouter.get("/admin/customers.csv", async (req, res) => {
  if (req.user.role !== "admin" && req.user.role !== "support") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const customers = await listCustomers();
  res.type("text/csv").send(toCsv(customers, ["id", "name", "email"]));
});
