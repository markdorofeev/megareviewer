import type { FileChange, Hunk } from "../diff/index.ts";

export interface Route {
  /** Upper case; ALL when the route takes any method. */
  readonly method: string;
  readonly path: string;
}

/** Where a user or caller reaches the changed code: what a flow in the tour starts from. */
export type Entry =
  | { readonly kind: "route"; readonly routes: readonly Route[] }
  | { readonly kind: "page"; readonly names: readonly string[] }
  | { readonly kind: "command"; readonly name: string; readonly path: string };

const METHODS = "get|post|put|patch|delete|head|options|all";
/** Objects routes are registered on, by convention: app.get, router.post, r.GET, mux.HandleFunc. */
const RECEIVER = String.raw`(?:app|router|server|mux|r|e|g|fastify|\w*(?:Router|router|App))`;
const PATH = String.raw`["'\`](\/[^"'\`]*)["'\`]`;

/**
 * One row per framework. A pattern finds a route on one added line, with its method and path.
 * Client calls such as `axios.get("/x")` don't match: only decorators and known receivers do.
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

const PAGE_DIRECTORIES = new Set(["routes", "pages", "app", "screens", "views"]);

const isPageFile = (path: string): boolean =>
  /\.(tsx|jsx)$/.test(path) &&
  path
    .split("/")
    .slice(0, -1)
    .some((directory) => PAGE_DIRECTORIES.has(directory));

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * The entry a hunk adds, read from its added lines and the definitions they change, so moving
 * old code around doesn't make one. Routes win over pages, pages over commands.
 */
export const entryOf = (
  file: FileChange,
  hunk: Hunk,
  definitions: readonly string[],
): Entry | null => {
  const added = hunk.lines.flatMap((line) => (line.kind === "add" ? [line.text] : []));
  const routes = added.flatMap((line) => ROUTE_PATTERNS.flatMap((pattern) => pattern(line)));
  if (routes.length > 0) return { kind: "route", routes: unique(routes) };
  const components = definitions.filter((name) => /^[A-Z]/.test(name));
  if (isPageFile(file.path) && components.length > 0) return { kind: "page", names: components };
  if (
    definitions.includes("main") ||
    added.some((line) => /^\s*if\s+__name__\s*==\s*["']__main__["']/.test(line))
  ) {
    return { kind: "command", name: "main", path: file.path };
  }
  return null;
};

const unique = (routes: readonly Route[]): Route[] => {
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** The longest leading run of whole path segments every path shares, without a trailing "/". */
const sharedPrefix = (paths: readonly string[]): string => {
  const split = paths.map((path) => path.split("/"));
  const first = split[0] ?? [];
  let length = 0;
  while (length < first.length && split.every((parts) => parts[length] === first[length])) {
    length += 1;
  }
  return first.slice(0, length).join("/");
};

const routesLabel = (routes: readonly Route[]): string => {
  if (routes.length === 1) return `${routes[0]?.method} ${routes[0]?.path}`;
  const prefix = sharedPrefix(routes.map((route) => route.path));
  if (prefix === "") return routes.map((route) => `${route.method} ${route.path}`).join(", ");
  const rest = routes.map((route) => {
    const tail = route.path.slice(prefix.length);
    return tail === "" ? route.method : `${route.method} ${tail}`;
  });
  return `${prefix}: ${rest.join(", ")}`;
};

/** A flow's title from its entries: the routes, page or command it starts at. */
export const entryLabel = (entries: readonly Entry[]): string => {
  const routes = entries.flatMap((entry) => (entry.kind === "route" ? entry.routes : []));
  const pages = entries.flatMap((entry) => (entry.kind === "page" ? entry.names : []));
  const commands = entries.flatMap((entry) => (entry.kind === "command" ? [entry] : []));
  return [
    ...(routes.length > 0 ? [routesLabel(unique(routes))] : []),
    ...(pages.length > 0 ? [`Page: ${[...new Set(pages)].join(", ")}`] : []),
    ...[...new Set(commands.map((command) => `Command: main in ${basename(command.path)}`))],
  ].join("; ");
};
