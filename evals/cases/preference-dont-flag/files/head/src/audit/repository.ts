import type { Db } from "../db.ts";

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  at: string;
}

export interface AuditPage {
  events: AuditEvent[];
  /** Every event of the account, on this page or not. */
  total: number;
}

const COLUMNS = "id, actor, action, target, at";

/** One page of an account's audit events, newest first. */
export const listAuditEvents = async (
  db: Db,
  accountId: string,
  page: { limit: number; offset: number },
): Promise<AuditPage> => {
  const events = await db.query<AuditEvent>(
    `SELECT ${COLUMNS} FROM audit_events WHERE account_id = $1 ORDER BY at DESC LIMIT $2 OFFSET $3`,
    [accountId, page.limit, page.offset],
  );
  const [count] = await db.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM audit_events WHERE account_id = $1",
    [accountId],
  );
  return { events, total: count?.total ?? 0 };
};
