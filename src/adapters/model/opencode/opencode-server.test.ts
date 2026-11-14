import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createOpencodeClient, type OpencodeFetch } from "./opencode-client.ts";
import { createOpencodeServer, type OpencodeServer } from "./opencode-server.ts";

/** A stand-in for `opencode serve`: says where it listens, answers with what it was started with. */
const FAKE = `
const http = require("node:http");
if (process.argv.includes("never")) setInterval(() => {}, 1000);
else {
  const server = http.createServer((req, res) => {
    if (req.url === "/die") { res.end(); process.exit(0); }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      pid: process.pid,
      cwd: process.cwd(),
      authorized: req.headers.authorization === "Basic " + Buffer.from("opencode:" + process.env.OPENCODE_SERVER_PASSWORD).toString("base64"),
      freeModels: process.env.OPENCODE_DISABLE_FREE_MODELS ?? null,
      config: JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "null"),
    }));
  });
  server.listen(0, "127.0.0.1", () => console.log("server listening on http://127.0.0.1:" + server.address().port));
}`;

/** Plain node:http on loopback, because tests block fetch. */
const loopback: OpencodeFetch = (url, init) =>
  new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const req = request(url, { method: init.method ?? "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve(
          new Response(Buffer.concat(chunks).toString("utf8"), { status: res.statusCode ?? 0 }),
        ),
      );
    });
    req.on("error", reject);
    req.end();
  });

const State = z.object({
  pid: z.number(),
  authorized: z.boolean(),
  freeModels: z.string().nullable(),
  config: z.unknown(),
});

const started: OpencodeServer[] = [];
const serverWith = (extra: readonly string[] = [], startTimeoutMs?: number) => {
  const server = createOpencodeServer({
    command: process.execPath,
    commandArgs: ["-e", FAKE, ...extra],
    ...(startTimeoutMs === undefined ? {} : { startTimeoutMs }),
  });
  started.push(server);
  return { server, client: createOpencodeClient(server, loopback) };
};

const said = async (client: ReturnType<typeof serverWith>["client"]) => {
  const answer = await client.request("GET", "/state");
  if (!answer.ok) throw new Error(JSON.stringify(answer.error));
  return State.parse(answer.value);
};

afterEach(() => {
  for (const server of started.splice(0)) server.stop();
});

describe("createOpencodeServer", () => {
  it("starts one server for requests that come at once, with its password and our config", async () => {
    const { client } = serverWith();
    const [first, second] = await Promise.all([said(client), said(client)]);
    expect(first.pid).toBe(second?.pid);
    expect(first).toMatchObject({
      authorized: true,
      freeModels: "1",
      config: { agents: { megareviewer: expect.objectContaining({ mode: "primary" }) } },
    });
  });

  it("starts it again on the next request after it died", async () => {
    const { client } = serverWith();
    const before = await said(client);
    await client.request("GET", "/die");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = await said(client);
    expect(after.pid).not.toBe(before.pid);
  });

  it("is stopped with megareviewer", async () => {
    const { server, client } = serverWith();
    const connection = await server.connect();
    if (!connection.ok) throw new Error(connection.error.message);
    await said(client);
    server.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(loopback(`${connection.value.url}/state`, {})).rejects.toThrow();
  });

  it("fails with why when it never says where it listens", async () => {
    const { server } = serverWith(["never"], 500);
    expect(await server.connect()).toEqual({
      ok: false,
      error: { kind: "failed", message: "`opencode serve` didn't start within 0.5 seconds" },
    });
  });

  it("says opencode isn't installed when the command isn't there", async () => {
    const server = createOpencodeServer({ command: "/nonexistent/opencode" });
    started.push(server);
    expect(await server.connect()).toEqual({
      ok: false,
      error: { kind: "not-installed", message: "opencode isn't installed" },
    });
  });
});
