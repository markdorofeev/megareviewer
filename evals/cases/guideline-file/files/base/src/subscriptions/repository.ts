import type { Db } from "../db.ts";

export interface Subscription {
  id: string;
  plan: string;
  status: "active" | "cancelled";
  renewsAt: string;
}

const COLUMNS = `id, plan, status, renews_at AS "renewsAt"`;

export const findSubscription = (
  db: Db,
  accountId: string,
  id: string,
): Promise<Subscription | null> =>
  db.queryOne<Subscription>(
    `SELECT ${COLUMNS} FROM subscriptions WHERE account_id = $1 AND id = $2`,
    [accountId, id],
  );
