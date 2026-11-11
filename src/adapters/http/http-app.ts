import { Hono } from "hono";
import type { AnalysisEvents } from "../../application/events/index.ts";
import type { Logger } from "../../application/ports/index.ts";
import type { UseCases } from "../../application/use-cases/index.ts";
import { errorResponse, registerApiRoutes } from "./api-routes.ts";
import { registerAttachmentRoute } from "./attachments.ts";
import { registerEventsRoute } from "./events.ts";
import { hostCheck, requestLog, securityHeaders, sessionToken } from "./middleware.ts";
import { registerStaticFiles } from "./static-files.ts";

export interface HttpAppOptions {
  readonly useCases: UseCases;
  readonly events: AnalysisEvents;
  readonly sessionToken: string;
  /** Host headers the server answers, e.g. "127.0.0.1:4823" and "localhost:4823". */
  readonly allowedHosts: readonly string[];
  /** The built UI; null in tests and in dev, where Vite serves it. */
  readonly staticDir: string | null;
  readonly logger: Logger;
}

/** The HTTP API of the contract in contracts/, plus the built UI, for the user's own tab only. */
export const createHttpApp = (options: HttpAppOptions): Hono => {
  const { useCases, events, logger } = options;
  const app = new Hono();

  app.use(requestLog(logger));
  // Before the host check, so its 403 has the headers too.
  app.use(securityHeaders);
  app.use(hostCheck(options.allowedHosts));
  app.use("/api/*", sessionToken(options.sessionToken));

  registerApiRoutes(app, useCases);
  registerEventsRoute(app, { useCases, events, logger });
  registerAttachmentRoute(app, useCases);
  if (options.staticDir !== null) registerStaticFiles(app, options.staticDir);

  app.notFound((c) =>
    c.req.path.startsWith("/api/")
      ? errorResponse(c, { code: "not-found", message: `No route ${c.req.method} ${c.req.path}` })
      : c.text("Not found", 404),
  );
  app.onError((error, c) => {
    logger.error("request failed", {
      method: c.req.method,
      path: c.req.path,
      error: error.stack ?? String(error),
    });
    return errorResponse(c, { code: "internal", message: "Something went wrong on the server" });
  });
  return app;
};
