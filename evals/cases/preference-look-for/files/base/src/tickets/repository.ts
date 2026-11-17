import type { Db } from "../db.ts";

export type TicketStatus = "open" | "pending" | "solved";

export interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  assigneeId: string | null;
  updatedAt: string;
}

const COLUMNS = `id, subject, status, assignee_id AS "assigneeId", updated_at AS "updatedAt"`;
const PAGE_SIZE = 50;

/** A tenant's tickets in one status, most recently updated first. */
export const listTickets = (db: Db, tenantId: string, status: TicketStatus): Promise<Ticket[]> =>
  db.query<Ticket>(
    `SELECT ${COLUMNS} FROM tickets WHERE tenant_id = $1 AND status = $2 ORDER BY updated_at DESC LIMIT ${PAGE_SIZE}`,
    [tenantId, status],
  );

export const findTicket = (db: Db, tenantId: string, id: string): Promise<Ticket | null> =>
  db.queryOne<Ticket>(`SELECT ${COLUMNS} FROM tickets WHERE tenant_id = $1 AND id = $2`, [
    tenantId,
    id,
  ]);
