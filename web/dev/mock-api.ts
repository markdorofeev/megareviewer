import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  createMockApi,
  isEventsRequest,
  MOCK_TOKEN,
  type MockApi,
  type MockRequest,
  type MockResponse,
} from "./mock-routes.ts";
import { isScenario, type Scenario } from "./scenarios.ts";

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const toMockRequest = async (request: IncomingMessage): Promise<MockRequest> => {
  const url = new URL(request.url ?? "/", "http://mock");
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  return {
    method: request.method ?? "GET",
    path: url.pathname,
    query: url.searchParams,
    headers,
    body: await readBody(request),
  };
};

const sendJson = (response: ServerResponse, { status, body }: MockResponse) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

/**
 * The scenario the page is open with: `?scenario=<name>` in its URL, which the API requests
 * carry in their Referer. A dev-only trick, so the whole page can be played without the model.
 * The page's own navigation drops the query, so a request without one keeps the scenario in
 * play; opening the page at another one switches.
 */
const scenarioOf = (referer: string | undefined): Scenario | undefined => {
  const name = referer === undefined ? null : new URL(referer).searchParams.get("scenario");
  return name !== null && isScenario(name) ? name : undefined;
};

/** Serves the HTTP API contract from fixtures, so the UI can be built without the server. */
export const mockApi = (): Plugin => ({
  name: "megareviewer-mock-api",
  configureServer(server) {
    let scenario: Scenario | undefined;
    let api = createMockApi();
    /** A new scenario starts a fresh API, so its analysis begins before Claude ran. */
    const apiFor = (next: Scenario | undefined): MockApi => {
      if (next === undefined || next === scenario) return api;
      api.close();
      scenario = next;
      api = createMockApi(next === undefined ? {} : { scenario: next });
      return api;
    };
    server.httpServer?.on("close", () => api.close());
    server.httpServer?.once("listening", () => {
      const address = server.httpServer?.address();
      const port = typeof address === "object" && address !== null ? address.port : 5173;
      server.config.logger.info(`  Mock API: open http://localhost:${port}/?token=${MOCK_TOKEN}`);
    });

    server.middlewares.use((request, response, next) => {
      const path = new URL(request.url ?? "/", "http://mock").pathname;
      if (!path.startsWith("/api/")) {
        next();
        return;
      }
      const api = apiFor(scenarioOf(request.headers.referer));
      void toMockRequest(request).then((mockRequest) => {
        if (!isEventsRequest(mockRequest.method, mockRequest.path)) {
          sendJson(response, api.handle(mockRequest));
          return;
        }
        const open = () => {
          if (response.headersSent) return;
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
          });
          response.flushHeaders();
        };
        // The first event can arrive before `events` returns.
        const subscription = api.events(mockRequest, (event) => {
          if (response.writableEnded) return;
          open();
          response.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
          if (event.event === "done") response.end();
        });
        if ("status" in subscription) {
          sendJson(response, subscription);
          return;
        }
        response.on("close", subscription.unsubscribe);
        open();
      });
    });
  },
});
