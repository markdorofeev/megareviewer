import type { Db } from "../db.ts";

export type TicketStatus = "open" | "pending" | "solved";

export interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  assigneeId: string | null;
  updatedAt: string;
}

export interface TicketFilter {
  status?: TicketStatus;
  assigneeId?: string;
}

const COLUMNS = `id, subject, status, assignee_id AS "assigneeId", updated_at AS "updatedAt"`;
const PAGE_SIZE = 50;

/** A tenant's tickets that match the filter, most recently updated first. */
export const listTickets = (
  db: Db,
  tenantId: string,
  filter: TicketFilter = {},
): Promise<Ticket[]> => {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filter.status !== undefined) {
    params.push(tenantId, filter.status);
    conditions.push("tenant_id = $1 AND status = $2");
  }
  if (filter.assigneeId !== undefined) {
    params.push(filter.assigneeId);
    conditions.push(`assignee_id = $${params.length}`);
  }
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  return db.query<Ticket>(
    `SELECT ${COLUMNS} FROM tickets ${where} ORDER BY updated_at DESC LIMIT ${PAGE_SIZE}`,
    params,
  );
};

export const findTicket = (db: Db, tenantId: string, id: string): Promise<Ticket | null> =>
  db.queryOne<Ticket>(`SELECT ${COLUMNS} FROM tickets WHERE tenant_id = $1 AND id = $2`, [
    tenantId,
    id,
  ]);
