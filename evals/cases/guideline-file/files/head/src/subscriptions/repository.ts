import type { Db } from "../db.ts";

export interface Subscription {
  id: string;
  plan: string;
  status: "active" | "cancelled";
  renewsAt: string;
  /** When it was paused; null while it isn't. */
  pausedAt: string | null;
}

const COLUMNS = `id, plan, status, renews_at AS "renewsAt", paused_at AS "pausedAt"`;

export const findSubscription = (
  db: Db,
  accountId: string,
  id: string,
): Promise<Subscription | null> =>
  db.queryOne<Subscription>(
    `SELECT ${COLUMNS} FROM subscriptions WHERE account_id = $1 AND id = $2`,
    [accountId, id],
  );

/** Pauses an account's active subscription. One already paused keeps the time it was paused at. */
export const pauseSubscription = (
  db: Db,
  accountId: string,
  id: string,
): Promise<Subscription | null> =>
  db.queryOne<Subscription>(
    `UPDATE subscriptions SET paused_at = COALESCE(paused_at, now())
     WHERE account_id = $1 AND id = $2 AND status = 'active'
     RETURNING ${COLUMNS}`,
    [accountId, id],
  );
