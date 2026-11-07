# Stage 29: Links from requests to routes

**Status:** Not started
**Depends on:** 28 (a request links to one route's part), 27 (the overview shows the link)
**Unblocks:** —
**Owns:** `src/domain/diff/requests.ts` (new), `src/domain/diff/call-graph.ts`, `src/domain/review/entry-points.ts` (route paths shared with requests), `src/domain/review/code-tour.ts`, the request chips in `web/src/pages/review/`

## Goal

Hints never cross languages, so a full-stack PR is two islands: the page and its components on one side, the routes and services on the other. Nothing on the page says that the form the reviewer is reading sends the request the route below handles.

This stage links a **request**, a call that names an HTTP method and a path, to the **route** in the PR that serves that method and path:

- through a typed or generated client: `client.PUT("/api/account-connections/{domain}/token", …)`, or a generated function whose body makes that call;
- through plain HTTP calls: `fetch("/p", { method: "PUT" })`, `axios.put("/p")`;
- through test clients: `client.put(f"/api/…/{domain}/token")` in a Python test.

A request link is a chip, a `via` link between flows and an edge in the overview. It never pulls the backend's code into the frontend's flow.

## Why, measured

On delphi-code #2:

- `ConnectionsSection.tsx` makes three requests through the typed client: `client.GET("/api/account-connections")` on line 21, `client.DELETE("/api/account-connections/{domain}/token")` on line 54 and `client.PUT(…)` on line 104. Each matches one route in `routes/hosting_services.py` exactly, method and path.
- `test_http_api.py` requests two of the routes (lines 207 and 243), but no hint links the test to the routes file. It joins the route flow today only through its imports of `app.py` and `application.py`.
- In the overview of stage 27, the frontend (`setup.tsx`, `ConnectionsSection.tsx`, `schema.d.ts`) and the backend share no edge. These three links are the only ones that would join them.
- `openapi.json` and `schema.d.ts` name the same paths as keys (lines 1720 and 7). They describe routes rather than request them, so they don't link.

## Read first

- [Stage 25](25-flows.md) task 1 (route markers) and its notes (route receivers)
- [Stage 28](28-hunk-parts.md), for parts
- `src/domain/review/entry-points.ts`, `src/domain/diff/call-graph.ts` (`canLink`), `src/domain/review/code-tour.ts`

## Contract change

A separate commit, with a line in stage 02's **Change log**:

- **`CallGraphHint.use` gains `"request"`:** from the part that makes a request to the part that adds the route. Its `symbol` is the method and path as the route has them (`PUT /api/account-connections/{domain}/token`), and its `line` is the request's.
- `PIPELINE_VERSION` goes from 8 to 9. The model's input leaves request hints out, so prompts and evals don't change.

## Tasks

### 1. Requests: `src/domain/diff/requests.ts`

`requestsOn(line, language)` returns `{ method, path }[]` for one added or context line. One row per client, like the route table:

- **Typed clients** (openapi-fetch and the like): `\w+.(GET|POST|PUT|PATCH|DELETE)("/p"`, upper-case methods.
- **Plain HTTP:** `fetch("/p")` (GET), and `fetch("/p", { method: "X" })` when the method is on the same line; `axios.get("/p")`, `api.post("/p")`, `http.put("/p")`, `ky.delete("/p")`.
- **Test clients:** `client.get("/p")` and `self.client.post("/p")` in test files (FastAPI's `TestClient`, Flask's and Django's test clients), and `request(app).get("/p")` (supertest).
- **Not requests:** route registrations, which `entryOf` reads; path strings with no method; schema keys.

### 2. Matching

- **Paths match by segment.** Placeholders match any one segment: `{domain}`, `:domain`, `<domain>`, `${domain}` and an f-string's `{domain}`. A literal segment matches only itself, so `/api/account-connections/github.example/token` matches `/{domain}/token`.
- **A base URL prefix** the client adds (`/api` and the like) isn't known. A request whose path matches a route's after removing its first segments matches only when exactly one route does.
- **Methods match exactly,** and `ALL` matches any.
- **Several routes match:** a hint to each, which stage 26 shows as one chip.

### 3. Hints

`buildCallGraphHints` adds a request hint from each part with a request to each route part it matches, across languages. Production code never links into tests, as for calls.

### 4. The tour

- A request edge never extends a flow's walk. The flow that makes the request lists the route's entry part in its `via`, and its explanation says "sends GET /api/account-connections (step 1)".
- A flow that only requests routes of earlier flows comes after them. On delphi-code #2, the page flow follows the three route flows.
- A test that requests a route joins that route's flow, before attaching by imports.

### 5. The page

- **Chips:** a request chip shows the method and path and opens the route's part inline, in its own language's highlighting.
- **The overview:** an edge from the requesting file to the route's file, drawn differently from calls (it crosses a process boundary). A test's requests add a badge on the routes file.
- **The palette** lists routes with the files that request them.

## Not in this stage

- **Requests built at runtime:** a path from a variable or a function, or a method passed as an argument.
- **GraphQL and RPC** (gRPC, tRPC), which have no method and path to match.
- **Clients generated without the path** in their source, such as a client built from the OpenAPI file at runtime.
- **Routes outside the PR.** A request to a route the PR doesn't change has nothing to link to; stage 30's local checkout could find it.

## Tests

- `requestsOn`: each client's row, on a matching line and on a near miss (`api.get(id)`, a route registration, a schema key).
- Matching: placeholders of each syntax, a literal segment against a placeholder, a prefix with one match and with two, method mismatch, `ALL`.
- Hints: a TSX request to a Python route links; production code to a test route doesn't; a request matching two routes makes two hints.
- The tour: the requesting flow's `via` names the route, its walk stops there, it comes after the route's flow, and a test that requests a route joins its flow.
- The page: a request chip opens the Python route inline, and the overview draws the request edge.
- Fixture: the synthetic PR shaped like delphi-code #2 gets the three requests from its TSX section.

## Definition of done

- [ ] Contract change commit, with the stage 02 change log line.
- [ ] Tasks above, with the tests.
- [ ] On delphi-code #2, `pnpm measure` shows 3 request hints from `ConnectionsSection.tsx`, one per route part, and 2 from `test_http_api.py`. The page flow passes through the three route flows, and the overview has an edge from `ConnectionsSection.tsx` to `routes/hosting_services.py`. Differences go in **Notes for later stages**.
- [ ] ARCHITECTURE.md "2. Deterministic prep" says requests link to routes across languages, and why they never extend a flow: a page flow that walked into the backend would read the whole PR.

## Open issues

_None yet._

## Notes for later stages

_None yet._
