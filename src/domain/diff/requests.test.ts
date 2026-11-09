// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these strings are lines of code that build paths.
import { describe, expect, it } from "vitest";
import {
  type Route,
  requestPlacesOn,
  requestsOn,
  routeReceivers,
  routesFor,
  routesOn,
} from "./requests.ts";

describe("requestsOn", () => {
  const ui = "web/src/setup/ConnectionsSection.tsx";
  const pyTest = "tests/test_http_api.py";

  it.each<[string, string, Route[]]>([
    // Typed clients.
    [
      'await client.GET("/api/account-connections")',
      ui,
      [{ method: "GET", path: "/api/account-connections" }],
    ],
    [
      'await client.PUT("/api/account-connections/{domain}/token", {',
      ui,
      [{ method: "PUT", path: "/api/account-connections/{domain}/token" }],
    ],
    ['api.client.DELETE("/items/{id}")', ui, [{ method: "DELETE", path: "/items/{id}" }]],
    // Plain HTTP.
    ['const r = await fetch("/api/items");', ui, [{ method: "GET", path: "/api/items" }]],
    ['fetch("/api/items", { method: "POST", body })', ui, [{ method: "POST", path: "/api/items" }]],
    ['fetch("/api/items", { headers })', ui, [{ method: "GET", path: "/api/items" }]],
    ["fetch(`${BASE}/api/items/${id}?full=1`)", ui, [{ method: "GET", path: "/api/items/${id}" }]],
    ['axios.get("/items")', ui, [{ method: "GET", path: "/items" }]],
    ["api.post('/items', body)", ui, [{ method: "POST", path: "/items" }]],
    ["this.http.put(`/items/${id}`)", ui, [{ method: "PUT", path: "/items/${id}" }]],
    ['ky.delete("/items/1")', ui, [{ method: "DELETE", path: "/items/1" }]],
    // Test clients.
    [
      'connections = client.get("/api/account-connections", headers=AUTHORIZED).json()',
      pyTest,
      [{ method: "GET", path: "/api/account-connections" }],
    ],
    [
      'response = client.put(f"/api/account-connections/{domain}/token", json=body)',
      pyTest,
      [{ method: "PUT", path: "/api/account-connections/{domain}/token" }],
    ],
    [
      'self.client.post("/api/projects/sync", headers=AUTHORIZED)',
      pyTest,
      [{ method: "POST", path: "/api/projects/sync" }],
    ],
    ['test_client.patch("/items/1")', pyTest, [{ method: "PATCH", path: "/items/1" }]],
    [
      'await request(app).get("/items").expect(200)',
      "test/items.test.ts",
      [{ method: "GET", path: "/items" }],
    ],
  ])("reads %s", (line, path, requests) => {
    expect(requestsOn(line, path)).toEqual(requests);
  });

  it.each<[string, string]>([
    ["api.get(id)", ui],
    ['this.http.put("/items/" + id)', ui],
    ['client.get("/api/items")', "src/sync.py"],
    ['fetch("/api/items", {', ui],
    ['fetch("/api/items", init)', ui],
    ['@router.put("/api/items/{id}")', "app/routes.py"],
    ['router.get("/items", list)', "src/routes.ts"],
    ['http.get("/api/items", () => HttpResponse.json([]))', "web/src/setup.test.tsx"],
    ['api.get("/items", async (req, res) => {', "src/server.ts"],
    ['v1.GET("/items", func(c *gin.Context) {', "main.go"],
    ['v1.GET("/items", listItems)', "main.go"],
    ['"/api/account-connections": {', "web/src/api/schema.d.ts"],
    ['url = "/api/account-connections/github.example/token"', pyTest],
    ['fetch("https://example.com/items")', ui],
  ])("finds no request in %s", (line, path) => {
    expect(requestsOn(line, path)).toEqual([]);
  });

  it("reads each request once", () => {
    expect(requestsOn('Promise.all([api.get("/a"), api.get("/a"), api.get("/b")])', ui)).toEqual([
      { method: "GET", path: "/a" },
      { method: "GET", path: "/b" },
    ]);
  });
});

describe("requestPlacesOn", () => {
  const placed = (line: string, path = "web/src/api.ts") =>
    requestPlacesOn(line, path).map(({ method, start, end }) => [method, line.slice(start, end)]);

  it("places each request's path in its line, query and all, repeats included", () => {
    expect(placed('fetch("/api/x?y=1"); fetch("/api/x?y=1")')).toEqual([
      ["GET", "/api/x?y=1"],
      ["GET", "/api/x?y=1"],
    ]);
    expect(placed("await api.put(`${base}/repos/${id}`, body)")).toEqual([["PUT", "/repos/${id}"]]);
    expect(
      placed(
        '    connections = self.client.get("/api/account-connections", headers=A)',
        "tests/test_api.py",
      ),
    ).toEqual([["GET", "/api/account-connections"]]);
  });

  it("finds nothing where requestsOn finds nothing", () => {
    expect(placed('router.get("/api/x", handler)')).toEqual([]);
    expect(placed('fetch("/api/" + id)')).toEqual([]);
  });
});

describe("routesOn", () => {
  it.each<[string, Route[]]>([
    ['@router.put("/p/{id}")', [{ method: "PUT", path: "/p/{id}" }]],
    [
      '@app.route("/p", methods=["GET", "POST"])',
      [
        { method: "GET", path: "/p" },
        { method: "POST", path: "/p" },
      ],
    ],
    ['@app.route("/p")', [{ method: "GET", path: "/p" }]],
    ['app.get("/p", handler)', [{ method: "GET", path: "/p" }]],
    ['@RequestMapping(value = "/p")', [{ method: "ALL", path: "/p" }]],
    ['mux.HandleFunc("GET /p", h)', [{ method: "GET", path: "/p" }]],
    ['axios.get("/p")', []],
  ])("reads %s", (line, routes) => {
    expect(routesOn(line)).toEqual(routes);
  });
});

describe("routeReceivers", () => {
  it.each([
    ['@connection_changes.put("/token", response_model=Token)', ["connection_changes"]],
    ['router.get("/items", list)', ["router"]],
    ['mux.HandleFunc("GET /items", list)', ["mux"]],
    ['@app.route("/items", methods=["GET"])', ["app"]],
    ['axios.get("/items")', []],
    ["return save(id)", []],
  ])("reads the router of %s", (line, receivers) => {
    expect(routeReceivers(line)).toEqual(receivers);
  });
});

describe("routesFor", () => {
  const route = (method: string, path: string): Route => ({ method, path });

  it.each<[string, string]>([
    ["/api/items/{id}", "/api/items/{item_id}"],
    ["/api/items/{id}", "/api/items/:id"],
    ["/api/items/{id}", "/api/items/<int:id>"],
    ["/api/items/${id}", "/api/items/{id}"],
    ["/api/items/42", "/api/items/{id}"],
    ["/api/items/github.example/token", "/api/items/{domain}/token"],
    ["/api/items/{id}", "/api/items/latest"],
    ["/api/items/42.json", "/api/items/{id}.json"],
    ["/api/items/", "/api/items"],
    ["/files/a", "/files/*"],
  ])("matches %s to the route %s", (request, path) => {
    expect(routesFor(route("GET", request), [route("GET", path)])).toEqual([route("GET", path)]);
  });

  it.each<[string, string]>([
    ["/api/items/latest", "/api/items/oldest"],
    ["/api/items/42/token", "/api/items/{id}"],
    ["/api/items", "/api/items/{id}"],
    ["/api/items/42.xml", "/api/items/{id}.json"],
  ])("doesn't match %s to the route %s", (request, path) => {
    expect(routesFor(route("GET", request), [route("GET", path)])).toEqual([]);
  });

  it("matches methods exactly, and ALL any method", () => {
    const routes = [route("GET", "/items"), route("PUT", "/items"), route("ALL", "/items")];
    expect(routesFor(route("PUT", "/items"), routes)).toEqual([routes[1], routes[2]]);
    expect(routesFor(route("DELETE", "/items"), routes)).toEqual([routes[2]]);
  });

  it("drops a base prefix the client adds when exactly one route matches without it", () => {
    const items = route("GET", "/items/{id}");
    expect(
      routesFor(route("GET", "/api/v1/items/7"), [items, route("GET", "/users/{id}")]),
    ).toEqual([items]);
    expect(routesFor(route("GET", "/api/items/7"), [items, route("GET", "/{kind}/{id}")])).toEqual(
      [],
    );
  });

  it("prefers routes that match the whole path to a prefixed match", () => {
    const whole = route("GET", "/api/items/{id}");
    expect(routesFor(route("GET", "/api/items/7"), [route("GET", "/items/{id}"), whole])).toEqual([
      whole,
    ]);
  });

  it("returns every route that matches exactly", () => {
    const routes = [route("GET", "/items/{id}"), route("GET", "/items/latest")];
    expect(routesFor(route("GET", "/items/latest"), routes)).toEqual(routes);
  });
});
