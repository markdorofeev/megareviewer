import { describe, expect, it } from "vitest";
import { hunk } from "../../application/testing/index.ts";
import type { FileChange, Hunk } from "../diff/index.ts";
import { type Entry, entryLabel, entryOf } from "./entry-points.ts";

const file = (path: string, ...hunks: Hunk[]): FileChange => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language: null,
  hunks,
  additions: 0,
  deletions: 0,
});

/** The entry of one hunk in `path` that adds `lines`. */
const entry = (path: string, lines: string[], definitions: string[] = []): Entry | null => {
  const added = hunk(
    path,
    `@@ -1,0 +1,${lines.length} @@`,
    lines.map((line) => `+${line}`),
  );
  return entryOf(file(path, added), added, definitions);
};

const routes = (path: string, ...lines: string[]) => {
  const found = entry(path, lines);
  return found?.kind === "route" ? found.routes.map((r) => `${r.method} ${r.path}`) : [];
};

describe("entryOf", () => {
  it.each([
    [
      "FastAPI",
      "api/routes.py",
      '@router.put("/accounts/{id}/token", response_model=X)',
      "PUT /accounts/{id}/token",
    ],
    ["FastAPI on the app", "main.py", "@app.get('/health')", "GET /health"],
    ["Flask without methods", "app.py", '@app.route("/login")', "GET /login"],
    ["Express", "src/server.ts", 'router.post("/orders", async (req, res) => {', "POST /orders"],
    [
      "Express on the app",
      "src/server.js",
      "app.delete(`/orders/:id`, remove);",
      "DELETE /orders/:id",
    ],
    [
      "a named router",
      "src/api.ts",
      'ordersRouter.patch("/orders/:id", update);',
      "PATCH /orders/:id",
    ],
    ["Gin", "main.go", 'r.GET("/ping", ping)', "GET /ping"],
    ["Spring", "Api.java", '@GetMapping("/users/{id}")', "GET /users/{id}"],
    ["Spring with a path", "Api.java", '@PostMapping(path = "/users")', "POST /users"],
    ["Spring's request mapping", "Api.java", '@RequestMapping(value = "/admin")', "ALL /admin"],
    ["net/http", "main.go", 'mux.HandleFunc("/ping", ping)', "ALL /ping"],
    ["net/http with a method", "main.go", 'http.HandleFunc("POST /items", create)', "POST /items"],
  ])("finds a %s route", (_, path, line, route) => {
    expect(routes(path, line)).toEqual([route]);
  });

  it("reads Flask's methods", () => {
    expect(routes("app.py", '@app.route("/items", methods=["GET", "POST"])')).toEqual([
      "GET /items",
      "POST /items",
    ]);
  });

  it("finds every route a hunk adds, once each", () => {
    expect(
      routes(
        "routes.py",
        '@router.get("/a")',
        "def a(): ...",
        '@router.put("/a/token")',
        '@router.get("/a")',
      ),
    ).toEqual(["GET /a", "PUT /a/token"]);
  });

  it.each([
    ["an HTTP client call", "web/api.ts", 'const users = await axios.get("/users");'],
    ["a client named api", "web/api.ts", 'return api.get("/users", { params });'],
    ["a map lookup", "src/cache.ts", 'const hit = cache.get("/users");'],
    ["a path without a leading slash", "src/server.ts", 'app.get("users", list);'],
    ["a Python client call", "client.py", 'response = requests.get("/users")'],
    ["a client on a member", "web/users.service.ts", 'return this.http.get("/users");'],
  ])("doesn't take %s for a route", (_, path, line) => {
    expect(entry(path, [line])).toBeNull();
  });

  it("reads only added lines", () => {
    const moved = hunk("routes.py", "@@ -1,2 +1,2 @@", [' @router.get("/a")', "-x = 1", "+x = 2"]);
    expect(entryOf(file("routes.py", moved), moved, [])).toBeNull();
  });

  it("finds a page: a component in a routes, pages, app, screens or views directory", () => {
    expect(entry("web/src/routes/setup.tsx", ["function SetupPage() {"], ["SetupPage"])).toEqual({
      kind: "page",
      names: ["SetupPage"],
    });
    expect(entry("app/dashboard/page.jsx", ["export default function Page() {"], ["Page"])).toEqual(
      {
        kind: "page",
        names: ["Page"],
      },
    );
    expect(entry("web/src/components/Form.tsx", ["function Form() {"], ["Form"])).toBeNull();
    expect(entry("web/src/routes/setup.tsx", ["function load() {"], ["load"])).toBeNull();
    expect(entry("web/src/routes/setup.ts", ["function Setup() {"], ["Setup"])).toBeNull();
  });

  it("finds a command: a changed main, or Python's main guard", () => {
    expect(entry("tools/hosts.py", ["    run()"], ["main"])).toEqual({
      kind: "command",
      name: "main",
      path: "tools/hosts.py",
    });
    expect(entry("cli.py", ['if __name__ == "__main__":'])).toEqual({
      kind: "command",
      name: "main",
      path: "cli.py",
    });
    expect(entry("cli.py", ["    main()"], ["helper"])).toBeNull();
  });

  it("prefers a route to a page, and a page to a command", () => {
    expect(entry("web/routes/api.tsx", ['app.get("/x", h);'], ["Page", "main"])?.kind).toBe(
      "route",
    );
    expect(entry("web/routes/page.tsx", ["x"], ["Page", "main"])?.kind).toBe("page");
  });
});

describe("entryLabel", () => {
  const route = (...pairs: [string, string][]): Entry => ({
    kind: "route",
    routes: pairs.map(([method, path]) => ({ method, path })),
  });

  it("names one route by its method and path", () => {
    expect(entryLabel([route(["PUT", "/accounts/{id}/token"])])).toBe("PUT /accounts/{id}/token");
  });

  it("names several routes by their shared prefix", () => {
    expect(
      entryLabel([
        route(
          ["GET", "/api/account-connections"],
          ["PUT", "/api/account-connections/{domain}/token"],
          ["DELETE", "/api/account-connections/{domain}/token"],
        ),
      ]),
    ).toBe("/api/account-connections: GET, PUT /{domain}/token, DELETE /{domain}/token");
  });

  it("lists routes in full when they share no prefix", () => {
    expect(entryLabel([route(["GET", "/a"]), route(["POST", "/b"])])).toBe("GET /a, POST /b");
  });

  it("names pages and commands, and joins different kinds", () => {
    expect(entryLabel([{ kind: "page", names: ["SetupPage"] }])).toBe("Page: SetupPage");
    expect(entryLabel([{ kind: "command", name: "main", path: "tools/hosts.py" }])).toBe(
      "Command: main in hosts.py",
    );
    expect(
      entryLabel([
        route(["GET", "/a"]),
        { kind: "page", names: ["A", "B"] },
        { kind: "page", names: ["A"] },
      ]),
    ).toBe("GET /a; Page: A, B");
  });
});
