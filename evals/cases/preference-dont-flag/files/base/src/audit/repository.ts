import type { Db } from "../db.ts";

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  at: string;
}

const COLUMNS = "id, actor, action, target, at";

/** An account's most recent audit events, newest first. */
export const listAuditEvents = (db: Db, accountId: string): Promise<AuditEvent[]> =>
  db.query<AuditEvent>(
    `SELECT ${COLUMNS} FROM audit_events WHERE account_id = $1 ORDER BY at DESC LIMIT 200`,
    [accountId],
  );
