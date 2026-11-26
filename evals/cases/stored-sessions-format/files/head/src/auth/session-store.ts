import type { RedisClient } from "../redis.ts";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface Session {
  readonly userId: string;
  readonly signedInAt: string;
  /** The organization the user is acting for, or null for their personal account. */
  readonly organizationId: string | null;
}

const keyOf = (id: string): string => `session:${id}`;

const encode = (session: Session): string => JSON.stringify(session);

const decode = (raw: string): Session => JSON.parse(raw);

export const createSessionStore = (redis: RedisClient) => ({
  async save(id: string, session: Session): Promise<void> {
    await redis.set(keyOf(id), encode(session), { EX: SESSION_TTL_SECONDS });
  },

  async load(id: string): Promise<Session | null> {
    const raw = await redis.get(keyOf(id));
    return raw === null ? null : decode(raw);
  },

  async remove(id: string): Promise<void> {
    await redis.del(keyOf(id));
  },
});
