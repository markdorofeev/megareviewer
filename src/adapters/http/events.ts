import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { type AnalysisUpdatedEvent, analysisEventsRoute } from "../../../contracts/index.ts";
import type { AnalysisEvent, AnalysisEvents } from "../../application/events/index.ts";
import type { Logger } from "../../application/ports/index.ts";
import type { UseCases } from "../../application/use-cases/index.ts";
import { inProgress } from "../../domain/review/index.ts";
import { errorResponse, summarizeIssues } from "./api-routes.ts";

/** Keeps idle connections from being closed by anything in between. */
const HEARTBEAT_MS = 15_000;

/** Forwards an analysis's events as server-sent events until it is complete or failed. */
export const registerEventsRoute = (
  app: Hono,
  deps: { readonly useCases: UseCases; readonly events: AnalysisEvents; readonly logger: Logger },
): void => {
  app.get(analysisEventsRoute.path, async (c) => {
    const params = analysisEventsRoute.params.safeParse(c.req.param());
    if (!params.success) {
      const message = summarizeIssues("params", params.error);
      return errorResponse(c, { code: "bad-request", message });
    }
    const { id } = params.data;

    // Subscribed before reading the status, so a `done` in between isn't missed.
    const queue: AnalysisEvent[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = deps.events.subscribe(id, (event) => {
      queue.push(event);
      wake?.();
    });

    const view = await deps.useCases.getAnalysisView(id);
    if (!view.ok) {
      unsubscribe();
      return errorResponse(c, view.error);
    }
    if (!inProgress(view.value.analysis)) queue.push({ type: "done" });

    return streamSSE(c, async (stream) => {
      stream.onAbort(() => wake?.());
      const heartbeat = setInterval(() => void stream.write(": heartbeat\n\n"), HEARTBEAT_MS);
      try {
        while (!stream.aborted) {
          const event = queue.shift();
          if (event === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = null;
          } else if (event.type === "done") {
            await stream.writeSSE({ event: "done", data: "{}" });
            return;
          } else {
            const data: AnalysisUpdatedEvent = { stage: event.stage, status: event.status };
            await stream.writeSSE({ event: "updated", data: JSON.stringify(data) });
          }
        }
      } catch (error) {
        deps.logger.error("events stream failed", { analysisId: id, error: String(error) });
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });
};
