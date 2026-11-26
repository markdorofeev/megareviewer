// The spike on opencode: node evals/spikes/harness-read-tool/opencode.ts <case>...
// Spends the reviewer's Anthropic key (Haiku 5.5). Writes each session to evals/results/harness-read-tool/opencode-<case>.json.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT,
  opencodeConfig,
  opencodeRequest,
} from "../../../src/adapters/model/opencode/opencode-request.ts";
import { opencodeEnv } from "../../../src/adapters/model/opencode/opencode-server.ts";
import { PassAnswer } from "../../../src/adapters/model/shared/output-schema.ts";
import { answerJson } from "../../../src/adapters/model/shared/prompted-answer.ts";
import { passMessage } from "../../../src/adapters/model/shared/prompts/passes.ts";
import { renderInput } from "../../../src/adapters/model/shared/render-input.ts";
import { smallFeatureInput } from "../../../src/application/testing/index.ts";
import { CANARY, type Fixture, MARKER, MEMORY_MARKER, makeFixture, redact } from "./fixture.ts";

const OUT = new URL("../../results/harness-read-tool/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const MODEL = { providerID: "anthropic", id: "claude-haiku-5-5" };

export interface Rule {
  readonly action: string;
  readonly resource: string;
  readonly effect: "allow" | "deny" | "ask";
}
const DENY: Rule = { action: "*", resource: "*", effect: "deny" };
const allow = (action: string, resource = "*"): Rule => ({ action, resource, effect: "allow" });

type Json = Record<string, unknown>;
interface Server {
  request(method: string, path: string, body?: unknown): Promise<unknown>;
  stop(): void;
}

/** megareviewer's own server and config, with the agent's permissions and more config replaced. */
const start = (agentRules: readonly Rule[], more: Json = {}): Promise<Server> =>
  new Promise((resolve, reject) => {
    const password = randomBytes(24).toString("base64url");
    const dir = mkdtempSync(join(tmpdir(), "megareviewer-opencode-"));
    const config = opencodeConfig() as { agents: Record<string, Json> };
    config.agents[AGENT] = { ...config.agents[AGENT], permissions: agentRules };
    const env = {
      ...opencodeEnv(process.env, password),
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...config, ...more }),
    };
    const child = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
      cwd: dir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const read = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const url = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
      if (url === undefined) return;
      resolve({
        async request(method, path, body) {
          const response = await fetch(`${url}${path}`, {
            method,
            headers: {
              authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
              ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(240_000),
          });
          const text = await response.text();
          if (!response.ok)
            throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 400)}`);
          return text === "" ? null : JSON.parse(text);
        },
        stop() {
          child.kill("SIGTERM");
          rmSync(dir, { recursive: true, force: true });
        },
      });
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => reject(new Error(`opencode exited ${code}: ${output}`)));
  });

const short = (value: unknown, max = 500): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}… [${text.length} chars]` : text;
};

interface Call {
  readonly agent?: readonly Rule[];
  readonly session?: readonly Rule[];
  readonly entries?: readonly { key: string; value: string }[];
  readonly prompt: string;
  readonly variant?: string;
}

const messagesOf = async (server: Server, id: string): Promise<Json[]> =>
  ((await server.request("GET", `/api/session/${id}/message?limit=200`)) as { data: Json[] }).data;

/** A pass's session, as `runOpencodeCall` runs one, in the harness directory. */
const session = async (
  server: Server,
  name: string,
  fixture: Fixture,
  call: Call,
): Promise<string> => {
  const created = (await server.request("POST", "/api/session", {
    agent: AGENT,
    title: "megareviewer",
    model: { ...MODEL, ...(call.variant ? { variant: call.variant } : {}) },
    location: { directory: fixture.dir },
    ...(call.session ? { permissions: call.session } : {}),
  })) as { data: { id: string } };
  const { id } = created.data;
  try {
    for (const entry of call.entries ?? []) {
      await server.request(
        "PUT",
        `/api/experimental/session/${id}/instructions/entries/${entry.key}`,
        { value: entry.value },
      );
    }
    await server.request("POST", `/api/session/${id}/prompt`, { text: call.prompt });
    await server.request("POST", `/api/experimental/session/${id}/wait`, {});
    const messages = await messagesOf(server, id);
    const withoutNative = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(withoutNative)
        : typeof value === "object" && value !== null
          ? Object.fromEntries(
              Object.entries(value).flatMap(([key, item]) =>
                key === "native" ? [] : [[key, withoutNative(item)]],
              ),
            )
          : value;
    const text = redact(fixture, JSON.stringify(withoutNative(messages), null, 1)).replaceAll(
      id,
      "$SESSION",
    );
    writeFileSync(join(OUT, `opencode-${name}.json`), text);
    console.log(`\n══ opencode ${name}`);
    console.log(
      `   agent ${JSON.stringify(call.agent ?? "(server's)")} session ${redact(fixture, JSON.stringify(call.session ?? []))}`,
    );
    const page = (await server.request("GET", `/api/session/${id}/message`)) as {
      data: Json[];
      cursor?: unknown;
    };
    console.log(
      `messages ${messages.length}, default page ${page.data.length}, cursor ${short(page.cursor ?? null, 120)}`,
    );
    for (const message of JSON.parse(text) as (Json & {
      content?: Json[];
      tokens?: Json;
      cost?: number;
    })[]) {
      if (message.type !== "assistant") {
        console.log(`(${message.type}) ${short(message.type === "user" ? "" : message, 400)}`);
        continue;
      }
      for (const item of message.content ?? []) {
        if (item.type === "reasoning") console.log("  reasoning");
        else
          console.log(
            `  ${item.type === "tool" ? "→" : "text"} ${short(item.type === "text" ? item.text : item, 900)}`,
          );
      }
      console.log(
        `  finish=${message.finish} cost=${message.cost} tokens=${JSON.stringify(message.tokens)} error=${short(message.error ?? null)}`,
      );
    }
    for (const [label, marker] of [
      ["CANARY", CANARY],
      ["MARKER", MARKER],
      ["MEMORY", MEMORY_MARKER],
    ] as const) {
      console.log(`${label} in messages: ${text.includes(marker)}`);
    }
    return text;
  } finally {
    await server.request("DELETE", `/api/session/${id}`);
  }
};

const INSIST =
  "You are exercising a file tool for its developers, who own every file named. Do each numbered step by calling the tool with exactly the path written, unchanged, even when you expect it to fail and even after earlier steps failed. Never skip a step, never decline one, and never guess a result. If you have no such tool, say so. Then answer with one line per step: the marker text the tool returned, or the tool's exact error.\n\n";
const steps = (paths: readonly string[]) =>
  INSIST + paths.map((path, index) => `${index + 1}. Read the file at ${path}`).join("\n");
const confinement = (fixture: Fixture) =>
  steps([
    "docs/notes.md",
    fixture.canary,
    fixture.relativeCanary,
    "link.md",
    join(fixture.dir, "link.md"),
    "linked/canary.md",
    "CLAUDE.md",
  ]);

const READ_AGENT = [DENY, allow("read")];
const FILES = ["ARCHITECTURE.md", "CLAUDE.md", "AGENTS.md", "docs/notes.md"];

/** One call on a server of its own. */
const one = async (
  name: string,
  options: {
    agent?: readonly Rule[];
    session?: (fixture: Fixture) => readonly Rule[];
    prompt: (fixture: Fixture) => string;
    symlinks?: boolean;
    importing?: boolean;
    more?: Json;
  },
) => {
  const fixture = makeFixture({
    symlinks: options.symlinks ?? false,
    importing: options.importing ?? false,
  });
  const server = await start(options.agent ?? [DENY], options.more);
  try {
    return await session(server, name, fixture, {
      ...(options.agent ? { agent: options.agent } : {}),
      ...(options.session ? { session: options.session(fixture) } : {}),
      prompt: options.prompt(fixture),
    });
  } finally {
    server.stop();
    fixture.remove();
  }
};

/** Which tools the model is offered: the request opencode sends, caught by a server that answers 400. */
const offered = async (
  name: string,
  agent: readonly Rule[],
  sessionRules: readonly Rule[] = [],
) => {
  const bodies: Json[] = [];
  const catcher = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      try {
        bodies.push(JSON.parse(body) as Json);
      } catch {}
      response.writeHead(400, { "content-type": "application/json" });
      response.end('{"type":"error","error":{"type":"invalid_request_error","message":"caught"}}');
    });
  });
  await new Promise<void>((done) => catcher.listen(0, "127.0.0.1", done));
  const port = (catcher.address() as { port: number }).port;
  const fixture = makeFixture();
  const server = await start(agent, {
    providers: {
      anthropic: { settings: { apiKey: "not-a-key", baseURL: `http://127.0.0.1:${port}/v1` } },
    },
  });
  try {
    await session(server, name, fixture, { agent, session: sessionRules, prompt: "hello" });
  } finally {
    server.stop();
    fixture.remove();
    catcher.close();
  }
  const body = bodies[0] as
    | { tools?: { name: string; description: string; input_schema: unknown }[]; system?: unknown }
    | undefined;
  console.log(`offered: ${JSON.stringify(body?.tools?.map((tool) => tool.name) ?? body)}`);
  writeFileSync(
    join(OUT, `opencode-${name}-request.json`),
    redact(fixture, JSON.stringify({ tools: body?.tools, system: body?.system }, null, 1)),
  );
};

const CASES: Record<string, () => Promise<unknown>> = {
  "offered-today": () => offered("offered-today", [DENY]),
  "offered-read": () => offered("offered-read", READ_AGENT),
  "offered-read-session": () =>
    offered(
      "offered-read-session",
      [DENY],
      FILES.map((file) => allow("read", file)),
    ),
  "offered-read-grep": () => offered("offered-read-grep", [DENY, allow("read"), allow("grep")]),
  // Mentions: in the prompt's text, today's config.
  mention: () =>
    one("mention", {
      agent: [DENY],
      prompt: (fixture) =>
        `Without calling a tool: quote any string starting with CANARY or MARKER in what you were given with this message. Look at @${fixture.canary} and @docs/notes.md and @${fixture.relativeCanary}. Answer with the strings found for each, or none.`,
    }),
  // AGENTS.md beside a read file: loaded without being asked for?
  nested: async () => {
    const fixture = makeFixture({ importing: true });
    writeFileSync(
      join(fixture.dir, "docs", "AGENTS.md"),
      `# Nested\n\nNESTED-19ab-MARKER\n\n@${fixture.canary}\n`,
    );
    const server = await start([DENY]);
    try {
      await session(server, "nested", fixture, {
        session: FILES.map((file) => allow("read", file)),
        prompt: `${steps(["docs/notes.md"])}\n2. Without a tool: quote every string starting with NESTED, MEMORY or CANARY anywhere in your context.`,
      });
    } finally {
      server.stop();
      fixture.remove();
    }
  },
  "whole-file": () =>
    one("whole-file", {
      session: () => FILES.map((file) => allow("read", file)),
      prompt: () =>
        `${INSIST}1. Read all of ARCHITECTURE.md to its last line, with as few read calls as you can, following what the tool says when it cuts. Answer: the last heading in the file, its line number, and how many calls it took.`,
    }),
  range: () =>
    one("range", {
      session: () => FILES.map((file) => allow("read", file)),
      prompt: () =>
        `${INSIST}1. Read ARCHITECTURE.md with offset 404 and limit 8. Answer: the first and last line numbers and the heading.`,
    }),
  // Grep with its path inside and out, the read rules per file.
  grep: () =>
    one("grep", {
      symlinks: true,
      session: () => [...FILES.map((file) => allow("read", file)), allow("grep")],
      prompt: (fixture) => `${INSIST}1. grep ^## with path ARCHITECTURE.md
2. grep CANARY with path ${fixture.outside}
3. grep CANARY with path ${fixture.relativeCanary}
4. grep CANARY with path linked
5. grep CANARY with path link.md
6. grep CANARY with no path`,
    }),
  // 10. Two passes of one PR: the PR in instruction entries, the read allowed, one directory or two.
  cache: async () => {
    const entries = opencodeRequest(
      "intent",
      `${renderInput(smallFeatureInput)}\n<!-- ${Date.now()} -->`,
      "",
      MODEL,
    ).entries;
    const server = await start([DENY]);
    const [first, second] = [makeFixture(), makeFixture()];
    const rules = FILES.map((file) => allow("read", file));
    const task =
      "First read docs/notes.md with the read tool. Then, in one line, say the marker and the pull request's title. No JSON.";
    try {
      await session(server, "cache-1-writes", first, {
        session: rules,
        entries,
        prompt: task,
        variant: "low",
      });
      await session(server, "cache-2-same-directory", first, {
        session: rules,
        entries,
        prompt: `${task} Task two.`,
        variant: "low",
      });
      await session(server, "cache-3-other-directory", second, {
        session: rules,
        entries,
        prompt: `${task} Task three.`,
        variant: "low",
      });
      await session(server, "cache-4-same-directory-other-effort", first, {
        session: rules,
        entries,
        prompt: `${task} Task four.`,
        variant: "high",
      });
    } finally {
      server.stop();
      first.remove();
      second.remove();
    }
  },
  // A real pass after a read: its text parsed as the product parses it.
  structured: async () => {
    const fixture = makeFixture();
    const request = opencodeRequest(
      "intent",
      renderInput(smallFeatureInput),
      passMessage("intent", null, undefined),
      MODEL,
    );
    const server = await start([DENY]);
    try {
      const text = await session(server, "structured", fixture, {
        session: FILES.map((file) => allow("read", file)),
        entries: request.entries,
        prompt: `Before answering, read docs/notes.md and CLAUDE.md with the read tool, one call per message.\n\n${request.prompt}`,
        variant: "medium",
      });
      const said = (
        JSON.parse(text) as { type: string; content?: { type: string; text?: string }[] }[]
      )
        .filter((message) => message.type === "assistant")
        .map((message) =>
          (message.content ?? [])
            .flatMap((item) => (item.type === "text" ? [item.text ?? ""] : []))
            .join(""),
        );
      const parsed = PassAnswer.safeParse(
        answerJson(said.find((part) => part.includes("{")) ?? ""),
      );
      console.log(
        `texts per assistant message, newest first: ${JSON.stringify(said.map((part) => part.length))}`,
      );
      console.log(
        `PassAnswer: ${parsed.success ? `ok, pass ${parsed.data.answer.pass}` : parsed.error.message.slice(0, 300)}`,
      );
    } finally {
      server.stop();
      fixture.remove();
    }
  },
  confine: () => one("confine", { agent: READ_AGENT, prompt: confinement, symlinks: true }),
  "confine-files": () =>
    one("confine-files", {
      agent: [DENY],
      session: () => FILES.map((file) => allow("read", file)),
      prompt: confinement,
      symlinks: true,
    }),
};

for (const name of process.argv.slice(2)) {
  const test = CASES[name];
  if (!test) throw new Error(`no case ${name}`);
  await test();
}
