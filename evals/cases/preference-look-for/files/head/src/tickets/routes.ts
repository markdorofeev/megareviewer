import type { Router } from "../http.ts";
import { findTicket, listTickets, type TicketStatus } from "./repository.ts";

const STATUSES: readonly TicketStatus[] = ["open", "pending", "solved"];

/** The status asked for. None, or one we don't know, lists every status. */
const parseStatus = (value: string | undefined): TicketStatus | undefined =>
  STATUSES.find((status) => status === value);

export const registerTicketRoutes = (router: Router): void => {
  router.get("/tickets", async (req, res) => {
    const tickets = await listTickets(req.db, req.tenantId, {
      status: parseStatus(req.query.status),
      assigneeId: req.query.assignee,
    });
    res.json({ tickets });
  });

  router.get("/tickets/:id", async (req, res) => {
    const ticket = await findTicket(req.db, req.tenantId, req.params.id);
    if (ticket === null) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ticket });
  });
};
