import { isTestFile } from "./test-files.ts";

/** A route a line declares, or a request a line sends: an HTTP method and a path. */
export interface Route {
  /** Upper case; ALL when the route takes any method. */
  readonly method: string;
  readonly path: string;
}

const METHODS = "get|post|put|patch|delete|head|options|all";
/** Objects routes are registered on, by convention: app.get, router.post, r.GET, mux.HandleFunc. */
const RECEIVER = String.raw`(?:app|router|server|mux|r|e|g|fastify|\w*(?:Router|router|App))`;
const PATH = String.raw`["'\`](\/[^"'\`]*)["'\`]`;

/**
 * One row per framework. A pattern finds a route on one line, with its method and path. Client
 * calls such as `axios.get("/x")` don't match: only decorators and known receivers do.
 */
const ROUTE_PATTERNS: readonly ((line: string) => Route[])[] = [
  // FastAPI and the like: @router.put("/p").
  (line) =>
    [...line.matchAll(new RegExp(String.raw`@[\w.]+\.(${METHODS})\(\s*${PATH}`, "gi"))].map(
      ([, method = "", path = ""]) => ({ method: method.toUpperCase(), path }),
    ),
  // Flask: @app.route("/p", methods=["GET", "POST"]).
  (line) => {
    const match = new RegExp(String.raw`@[\w.]+\.route\(\s*${PATH}(.*)`).exec(line);
    if (match === null) return [];
    const [, path = "", rest = ""] = match;
    const methods = /methods\s*=\s*[[(]([^\])]*)/.exec(rest)?.[1];
    const listed = [...(methods ?? "").matchAll(/["'](\w+)["']/g)].map(([, m = ""]) =>
      m.toUpperCase(),
    );
    return (listed.length > 0 ? listed : ["GET"]).map((method) => ({ method, path }));
  },
  // Express, Fastify, Gin, Echo, Chi: app.get("/p", …), r.GET("/p", …).
  (line) =>
    [
      ...line.matchAll(
        new RegExp(String.raw`(?<![\w@.])${RECEIVER}\.(${METHODS})\(\s*${PATH}`, "gi"),
      ),
    ].map(([, method = "", path = ""]) => ({ method: method.toUpperCase(), path })),
  // Spring: @GetMapping("/p"), @RequestMapping(value = "/p").
  (line) => {
    const match = new RegExp(
      String.raw`@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:(?:value|path)\s*=\s*)?${PATH}`,
    ).exec(line);
    if (match === null) return [];
    const [, verb = "", path = ""] = match;
    return [{ method: verb === "Request" ? "ALL" : verb.toUpperCase(), path }];
  },
  // Go's net/http: mux.HandleFunc("/p", …) and, since Go 1.22, HandleFunc("GET /p", …).
  (line) => {
    const match = /\bHandle(?:Func)?\(\s*"(?:([A-Z]+) )?(\/[^"]*)"/.exec(line);
    if (match === null) return [];
    const [, method = "ALL", path = ""] = match;
    return [{ method, path }];
  },
];

/** The routes one line declares, in the order the framework rows find them. */
export const routesOn = (line: string): Route[] =>
  ROUTE_PATTERNS.flatMap((pattern) => pattern(line));

/**
 * The objects a line declares routes on: `router` in `@router.put("/p")` or `router.get("/p", …)`.
 * Empty when the line declares no route.
 */
export const routeReceivers = (line: string): string[] =>
  routesOn(line).length > 0
    ? [
        ...line.matchAll(
          new RegExp(String.raw`([\w$]+)\s*\.\s*(?:${METHODS}|route|Handle|HandleFunc)\(`, "gi"),
        ),
      ].flatMap(([, receiver]) => receiver ?? [])
    : [];

/**
 * A path argument: a string starting with "/", in any quotes, with Python's string prefixes (an
 * f-string's `{x}` is a placeholder) and a template literal's leading `${base}`, which a client
 * adds and which `pathsMatch` treats as an unknown prefix.
 */
const REQUEST_PATH = String.raw`(?<![\w])(?:[fFrRuU]{1,2})?(?<quote>["'\`])(?:\$\{[^}]*\})?(?<path>\/[^"'\`]*)\k<quote>`;
/** A function as the argument after the path: a route or a mock handler, not a request. */
const HANDLER = /^\s*,\s*(?:async\b|function\b|func\b|\(|[\w$]+\s*=>)/;

/**
 * Requests found by one row: the method, the path, where the path starts in the line, and what
 * follows the call's path.
 */
type Found = {
  readonly method: string | null;
  readonly path: string;
  readonly start: number;
  readonly rest: string;
};

/** Calls to `callee` with a path as their first argument; its `method` group is the method. */
const callsOn = (line: string, callee: string, flags = "g"): Found[] =>
  [...line.matchAll(new RegExp(String.raw`${callee}\(\s*${REQUEST_PATH}`, flags))].map((match) => {
    const path = match.groups?.path ?? "";
    const end = match.index + match[0].length;
    // The match ends with the path and its closing quote.
    return {
      method: match.groups?.method?.toUpperCase() ?? null,
      path,
      start: end - 1 - path.length,
      rest: line.slice(end),
    };
  });

const CLIENT_METHODS = "get|post|put|patch|delete|head|options";

/** One row per kind of client. A row finds requests on one line, with their method and path. */
const REQUEST_PATTERNS: readonly ((line: string, path: string) => Found[])[] = [
  // Typed clients, like openapi-fetch: client.PUT("/p/{id}", …). Methods in upper case. Not in
  // Go, where Gin declares routes that way on any router group.
  (line, path) =>
    path.endsWith(".go")
      ? []
      : callsOn(line, String.raw`(?<![\w$])[\w$.]*[\w$]\.(?<method>GET|POST|PUT|PATCH|DELETE)`),
  // Plain HTTP clients: axios.get("/p"), api.post("/p"), this.http.put("/p"), ky.delete("/p").
  (line) =>
    callsOn(
      line,
      String.raw`(?<![\w$@.])(?:this\.|self\.)?(?:axios|api|http|\$http|ky)\.(?<method>${CLIENT_METHODS})`,
      "gi",
    ),
  // fetch("/p") is a GET; with options on the same line, their method, else still a GET.
  (line) =>
    callsOn(line, String.raw`(?<![\w$.])(?:window\.)?fetch`).flatMap((found) => {
      if (/^\s*\)/.test(found.rest)) return [{ ...found, method: "GET" }];
      const options = /^\s*,\s*\{([^}]*)\}/.exec(found.rest)?.[1];
      if (options === undefined) return [];
      const method = /\bmethod\s*:\s*["'`](\w+)["'`]/.exec(options)?.[1];
      return [{ ...found, method: (method ?? "GET").toUpperCase() }];
    }),
  // Test clients: FastAPI's, Flask's and Django's (self.client.get), and supertest's request(app).
  (line, path) =>
    isTestFile(path)
      ? [
          ...callsOn(
            line,
            String.raw`(?<![\w$@])(?:(?:self|this)\.)?(?:\w*_)?[cC]lient\.(?<method>${CLIENT_METHODS})`,
            "gi",
          ),
          ...callsOn(
            line,
            String.raw`(?<![\w$.])(?:request|supertest)\([\w$.]+\)\.(?<method>${CLIENT_METHODS})`,
            "gi",
          ),
        ]
      : [],
];

/**
 * Requests on one line of `path`: calls that name an HTTP method and a literal path. Route
 * declarations and handlers aren't requests; test clients count only in tests.
 */
export const requestsOn = (line: string, path: string): Route[] => {
  const seen = new Set<string>();
  return requestPlacesOn(line, path).flatMap(({ method, path: requested }) => {
    const key = `${method} ${requested}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ method, path: requested }];
  });
};

/** A request with where its path stands in the line: characters `start` to `end`, end excluded. */
export interface RequestPlace extends Route {
  readonly start: number;
  readonly end: number;
}

/** The requests `requestsOn` finds, each with its path's place in the line, repeats included. */
export const requestPlacesOn = (line: string, path: string): RequestPlace[] => {
  if (routesOn(line).length > 0) return [];
  return REQUEST_PATTERNS.flatMap((pattern) => pattern(line, path)).flatMap((found) => {
    // A path with more added to it is built at runtime: what it reaches isn't known.
    if (found.method === null || HANDLER.test(found.rest) || /^\s*\+/.test(found.rest)) return [];
    const requested = found.path.replace(/[?#].*$/, "");
    return [
      {
        method: found.method,
        path: requested,
        start: found.start,
        end: found.start + found.path.length,
      },
    ];
  });
};

/** `{id}`, `:id`, `<id>`, `<int:id>`, `${id}`, or a lone `*`: one segment, whatever it holds. */
const PLACEHOLDER = /\$\{[^}]*\}|\{[^}]*\}|<[^>]*>|^:[\w$]+$|^\*$/g;

const segments = (path: string): string[] =>
  path
    .replace(/\/+$/, "")
    .split("/")
    .filter((segment) => segment !== "");

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a segment with placeholders, like `{id}.json`, can be the literal segment `text`. */
const fits = (pattern: string, text: string): boolean => {
  const literal = pattern.split(PLACEHOLDER).map(escapeRegExp);
  return new RegExp(`^${literal.join("[^/]+")}$`).test(text);
};

const hasPlaceholder = (segment: string): boolean => segment.match(PLACEHOLDER) !== null;

const segmentsMatch = (a: string, b: string): boolean => {
  if (a === b) return true;
  const [aOpen, bOpen] = [hasPlaceholder(a), hasPlaceholder(b)];
  if (aOpen && bOpen) return a.replace(PLACEHOLDER, "{}") === b.replace(PLACEHOLDER, "{}");
  if (aOpen) return fits(a, b);
  if (bOpen) return fits(b, a);
  return false;
};

const pathsMatch = (request: readonly string[], route: readonly string[]): boolean =>
  request.length === route.length &&
  request.every((segment, at) => segmentsMatch(segment, route[at] ?? ""));

const methodsMatch = (request: Route, route: Route): boolean =>
  route.method === "ALL" || request.method === route.method;

/**
 * The routes a request reaches. Paths match segment by segment, a placeholder in either matching
 * any one segment, and methods exactly, a route's ALL matching any. Every route that matches
 * exactly is returned. Without one, a client may add a base prefix (`/api`) the code doesn't
 * show, so the request's leading segments are dropped one at a time; that matches only when
 * exactly one route does.
 */
export const routesFor = <T extends Route>(request: Route, routes: readonly T[]): T[] => {
  const wanted = segments(request.path);
  const candidates = routes.filter((route) => methodsMatch(request, route));
  const exact = candidates.filter((route) => pathsMatch(wanted, segments(route.path)));
  if (exact.length > 0) return exact;
  const prefixed = candidates.filter((route) => {
    const tail = segments(route.path);
    return (
      tail.length > 0 &&
      tail.length < wanted.length &&
      pathsMatch(wanted.slice(wanted.length - tail.length), tail)
    );
  });
  return prefixed.length === 1 ? prefixed : [];
};
