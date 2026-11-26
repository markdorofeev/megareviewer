import type { Handler } from "../http.ts";
import type { createSessionStore } from "./session-store.ts";

/** Every signed-in route runs behind this. */
export const requireSession =
  (sessions: ReturnType<typeof createSessionStore>): Handler =>
  async (request, response, next) => {
    const id = request.cookies.sid;
    const session = id === undefined ? null : await sessions.load(id);
    if (session === null) return response.status(401).json({ error: "not_signed_in" });
    request.userId = session.userId;
    return next();
  };
