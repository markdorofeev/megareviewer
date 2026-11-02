import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { StatusResponse, TOKEN_HEADER } from "../../contracts/index.ts";
import {
  allFixtures,
  FakeAnalysisModel,
  FakeCodeParser,
  FakeGitHost,
  FakeTicketSource,
  FixedClock,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  RecordingLogger,
  smallFeatureAnalysis,
  smallFeatureInput,
  smallFeatureIntent,
} from "../application/testing/index.ts";
import {
  anthropicConfigured,
  assemble,
  type Composition,
  compose,
  NO_ANTHROPIC_CREDENTIALS,
  newSessionToken,
  unconfiguredModel,
} from "./compose.ts";
import type { Config } from "./config.ts";
import { serve } from "./serve.ts";

const GRAMMARS = fileURLToPath(new URL("../adapters/treesitter/grammars", import.meta.url));

/** Plain node:http on loopback, because tests block fetch. Host is 127.0.0.1:<port>. */
const get = (port: number, path: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const fakeComposition = () => {
  const clock = new FixedClock("2026-10-22T10:00:00Z");
  return assemble(
    {
      hosts: { github: new FakeGitHost({ host: "github", fixtures: allFixtures, clock }) },
      tickets: new FakeTicketSource(),
      model: new FakeAnalysisModel(),
      modelEnabled: true,
      store: new InMemoryAnalysisStore(),
      fileCache: new InMemoryFileCache(),
      parser: new FakeCodeParser(),
      clock,
      logger: new RecordingLogger(),
    },
    { staticDir: null, version: "1.2.3", close: async () => {} },
  );
};

describe("assemble and serve", () => {
  it("serves the API on a free port, behind the session token", async () => {
    const composition = await fakeComposition();
    const server = await serve(composition.app, 0);
    cleanups.push(() => server.close());

    const authorized = await get(server.port, "/api/status", {
      [TOKEN_HEADER]: composition.sessionToken,
    });
    expect(authorized.status).toBe(200);
    expect(StatusResponse.parse(JSON.parse(authorized.body)).version).toBe("1.2.3");

    expect((await get(server.port, "/api/status")).status).toBe(401);
  });

  it("answers only the Host of the port it got", async () => {
    const composition = await fakeComposition();
    const server = await serve(composition.app, 0);
    cleanups.push(() => server.close());
    const headers = { [TOKEN_HEADER]: composition.sessionToken };

    const localhost = await get(server.port, "/api/status", {
      ...headers,
      host: `localhost:${server.port}`,
    });
    expect(localhost.status).toBe(200);
    const otherPort = await get(server.port, "/api/status", {
      ...headers,
      host: `127.0.0.1:${server.port + 1}`,
    });
    expect(otherPort.status).toBe(403);
  });

  it("fails analyses interrupted by an earlier exit before serving", async () => {
    const store = new InMemoryAnalysisStore();
    await store.saveAnalysis({ ...smallFeatureAnalysis, status: "running" });
    const logger = new RecordingLogger();
    await assemble(
      {
        hosts: {},
        tickets: new FakeTicketSource(),
        model: new FakeAnalysisModel(),
        modelEnabled: true,
        store,
        fileCache: new InMemoryFileCache(),
        parser: new FakeCodeParser(),
        clock: new FixedClock(),
        logger,
      },
      { staticDir: null, version: "1.2.3", close: async () => {} },
    );
    expect((await store.getAnalysis(smallFeatureAnalysis.id))?.status).toBe("failed");
  });

  it("uses a given session token", async () => {
    const composition = await assemble(
      {
        hosts: {},
        tickets: new FakeTicketSource(),
        model: new FakeAnalysisModel(),
        modelEnabled: false,
        store: new InMemoryAnalysisStore(),
        fileCache: new InMemoryFileCache(),
        parser: new FakeCodeParser(),
        clock: new FixedClock(),
        logger: new RecordingLogger(),
      },
      { staticDir: null, version: "1", sessionToken: "fixed", close: async () => {} },
    );
    expect(composition.sessionToken).toBe("fixed");
    expect(composition.modelEnabled).toBe(false);
  });
});

describe("compose", () => {
  const configIn = async (): Promise<Config> => ({
    github: { token: "ghp_test", source: "GITHUB_TOKEN" },
    bitbucket: {
      credential: "api token",
      username: "lee@example.com",
      password: "bb-test",
      workspace: null,
    },
    jira: null,
    home: join(await mkdtemp(join(tmpdir(), "megareviewer-cli-")), "home"),
    logLevel: "info",
  });
  const options = { grammarsDir: GRAMMARS, staticDir: null, ai: false, version: "1.2.3" };

  const composed = async (config: Config): Promise<Composition> => {
    const result = await compose(config, { ...options, logger: new RecordingLogger() });
    if (!result.ok) throw new Error(result.error);
    cleanups.push(() => result.value.close());
    return result.value;
  };

  it("creates the home directory with mode 0700 and the database in it", async () => {
    const config = await configIn();
    await composed(config);
    expect((await stat(config.home)).mode & 0o777).toBe(0o700);
    expect((await stat(join(config.home, "db.sqlite"))).isFile()).toBe(true);
  });

  it("doesn't mount fake mode's control routes", async () => {
    const composition = await composed(await configIn());
    const response = await composition.app(4823).request("/__fake/publications", {
      headers: { host: "127.0.0.1:4823", [TOKEN_HEADER]: composition.sessionToken },
    });
    expect(response.status).toBe(404);
  });

  it("closes the database on close, and close can be called again", async () => {
    const composition = await composed(await configIn());
    await composition.close();
    await expect(composition.useCases.recoverInterruptedAnalyses()).rejects.toThrow(
      /finalized|not open/,
    );
    await composition.close();
  });

  it("fails with a message when the home directory can't be created", async () => {
    const config = await configIn();
    const file = join(config.home, "..", "a-file");
    await writeFile(file, "");
    const result = await compose(
      { ...config, home: join(file, "home") },
      { ...options, logger: new RecordingLogger() },
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Can't create") });
  });

  it("fails with the store's message for a database from a newer version", async () => {
    const config = await configIn();
    await composed(config).then((composition) => composition.close());
    const db = new DatabaseSync(join(config.home, "db.sqlite"));
    db.exec("PRAGMA user_version = 9999");
    db.close();
    const result = await compose(config, { ...options, logger: new RecordingLogger() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^Can't open the database at .*upgrade/i);
  });
});

describe("Anthropic credentials", () => {
  it("counts an API key as configured", async () => {
    const client = new Anthropic({ apiKey: "sk-ant-test" });
    expect(await anthropicConfigured(client, new RecordingLogger())).toBe(true);
  });

  it("fails every pass of the unconfigured model with the fix", async () => {
    const model = unconfiguredModel("claude/p1");
    expect(model.version).toBe("claude/p1");
    const failure = {
      ok: false,
      error: { kind: "unauthorized", message: NO_ANTHROPIC_CREDENTIALS },
    };
    expect(await model.checkSize(smallFeatureInput)).toEqual(failure);
    expect(await model.intent(smallFeatureInput)).toEqual(failure);
    expect(await model.tour(smallFeatureInput, smallFeatureIntent, [], [])).toEqual(failure);
  });
});

describe("newSessionToken", () => {
  it("is 32 random bytes in base64url", () => {
    const token = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(token);
  });
});
