import type { Router } from "../http.ts";
import { listAuditEvents } from "./repository.ts";

const PAGE_SIZE = 50;

/** The page asked for, counting from 1. Anything else is the first page. */
const parsePage = (value: string | undefined): number => {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
};

export const registerAuditRoutes = (router: Router): void => {
  router.get("/audit-log", async (req, res) => {
    const page = parsePage(req.query.page);
    const offset = page * PAGE_SIZE;
    console.log("audit-log", { page, offset });
    const { events, total } = await listAuditEvents(req.db, req.accountId, {
      limit: PAGE_SIZE,
      offset,
    });
    res.json({ events, page, pages: Math.ceil(total / PAGE_SIZE) });
  });
};
