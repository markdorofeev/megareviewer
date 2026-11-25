import { randomUUID } from "node:crypto";
import type { User } from "../users.ts";
import type { createSessionStore } from "./session-store.ts";

/** Starts a session for a user whose password has been checked, and answers its ID. */
export const signIn = async (
  sessions: ReturnType<typeof createSessionStore>,
  user: User,
): Promise<string> => {
  const id = randomUUID();
  await sessions.save(id, { userId: user.id, signedInAt: new Date().toISOString() });
  return id;
};
