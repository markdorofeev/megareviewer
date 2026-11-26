import type { RedisClient } from "../redis.ts";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface Session {
  readonly userId: string;
  readonly signedInAt: string;
}

const keyOf = (id: string): string => `session:${id}`;

const encode = (session: Session): string => `${session.userId}|${session.signedInAt}`;

const decode = (raw: string): Session => {
  const [userId = "", signedInAt = ""] = raw.split("|");
  return { userId, signedInAt };
};

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
