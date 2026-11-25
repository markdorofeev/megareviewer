// The spike on Claude Code: node evals/spikes/harness-read-tool/claude-code.ts <case>...
// Spends the reviewer's plan (Haiku 5.5). Writes each case's stream to evals/results/harness-read-tool/claude-<case>.jsonl.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath, sep } from "node:path";
import {
  claudeCodeArgs,
  claudeCodeSystemPrompt,
} from "../../../src/adapters/model/claude/claude-code-request.ts";
import { claudeEnv } from "../../../src/adapters/model/claude/run-claude.ts";
import { passAnswerFormat } from "../../../src/adapters/model/shared/output-schema.ts";
import { passMessage } from "../../../src/adapters/model/shared/prompts/passes.ts";
import { renderInput } from "../../../src/adapters/model/shared/render-input.ts";
import { smallFeatureInput } from "../../../src/application/testing/index.ts";
import { CANARY, type Fixture, MARKER, MEMORY_MARKER, makeFixture, redact } from "./fixture.ts";

export const MODEL = "claude-haiku-5-5";
const OUT = new URL("../../results/harness-read-tool/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

export const REPORT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: { step: { type: "string" }, outcome: { type: "string" } },
        required: ["step", "outcome"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

export interface Settings {
  readonly tools: string;
  readonly restricted: boolean;
  readonly maxTurns?: number;
  readonly effort?: string;
  readonly extra?: readonly string[];
  readonly schema?: object;
  /** An undefined variable is left out. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Kills the process on a Read whose path resolves outside the directory. */
  readonly killOutside?: boolean;
}

/** megareviewer's own arguments, with only `--tools`, `--max-turns` and what's added changed. */
export const args = (settings: Settings): string[] => {
  const base = claudeCodeArgs(MODEL, settings.effort ?? "low", settings.schema ?? REPORT_SCHEMA);
  base[base.indexOf("--tools") + 1] = settings.tools;
  base[base.indexOf("--max-turns") + 1] = String(settings.maxTurns ?? 12);
  // The system prompt is kept out of the directory the model can read.
  base[base.indexOf("--system-prompt-file") + 1] = "../system.txt";
  return [...base, ...(settings.restricted ? ["--restricted"] : []), ...(settings.extra ?? [])];
};

interface Block {
  type: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  text?: string;
}
interface Event {
  type: string;
  subtype?: string;
  tools?: string[];
  mcp_servers?: unknown[];
  message?: { content: Block[] | string; usage?: Record<string, unknown> };
  structured_output?: unknown;
  usage?: Record<string, unknown>;
  num_turns?: number;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  permission_denials?: unknown;
  [key: string]: unknown;
}

const short = (value: unknown, max = 400): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}… [${text.length} chars]` : text;
};

export const run = async (
  name: string,
  fixture: Fixture,
  system: string,
  prompt: string,
  settings: Settings,
): Promise<{ events: Event[]; raw: string }> => {
  writeFileSync(join(fixture.root, "system.txt"), system);
  const argv = args(settings);
  const started = Date.now();
  const raw = await new Promise<string>((resolve) => {
    const child = spawn("claude", argv, {
      cwd: fixture.dir,
      env: { ...claudeEnv(process.env), ...settings.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (!settings.killOutside || child.killed) return;
      for (const line of out.split("\n").slice(0, -1)) {
        const event = JSON.parse(line) as Event;
        const content = event.type === "assistant" ? event.message?.content : undefined;
        for (const block of typeof content === "string" ? [] : (content ?? [])) {
          const path =
            block.type === "tool_use" && block.name === "Read" ? block.input?.file_path : undefined;
          if (
            typeof path !== "string" ||
            resolvePath(fixture.dir, path).startsWith(fixture.dir + sep)
          )
            continue;
          console.log(`killed on ${redact(fixture, path)}`);
          child.kill("SIGTERM");
        }
      }
    });
    let error = "";
    child.stderr.on("data", (chunk: Buffer) => (error += chunk.toString("utf8")));
    child.on("close", (code) => {
      if (error) console.log(`stderr: ${error.trim()}`);
      if (code !== 0) console.log(`exit ${code}`);
      resolve(out);
    });
    child.stdin.end(prompt);
  });
  const stream = redact(fixture, raw);
  writeFileSync(join(OUT, `claude-${name}.jsonl`), stream);
  const events = stream
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event);
  console.log(`\n══ ${name} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`   ${redact(fixture, argv.filter((arg) => !arg.startsWith("{")).join(" "))}`);
  for (const event of events) {
    if (event.type === "system" && event.subtype === "init") {
      console.log(
        `init tools=${JSON.stringify(event.tools)} mcp=${JSON.stringify(event.mcp_servers)} mode=${event.permissionMode} memory=${JSON.stringify(event.memory_paths)} agents=${JSON.stringify(event.agents)} skills=${JSON.stringify(event.skills)} cwd=${event.cwd} version=${event.claude_code_version}`,
      );
    } else if (event.type === "assistant" || event.type === "user") {
      const content = event.message?.content;
      for (const block of typeof content === "string"
        ? [{ type: "text", text: content }]
        : (content ?? [])) {
        if (block.type === "tool_use") console.log(`→ ${block.name} ${short(block.input)}`);
        else if (block.type === "tool_result")
          console.log(`← ${block.is_error ? "ERROR " : ""}${short(block.content)}`);
        else if (block.type === "text") console.log(`${event.type}: ${short(block.text ?? "")}`);
      }
    } else if (event.type === "result") {
      console.log(
        `result ${event.subtype} turns=${event.num_turns} error=${event.is_error} cost=$${event.total_cost_usd}`,
      );
      console.log(
        `usage ${short({ ...event.usage, iterations: undefined, server_tool_use: undefined, cache_creation: undefined, service_tier: undefined, inference_geo: undefined, speed: undefined })}`,
      );
      console.log(`denials ${short(event.permission_denials ?? null, 800)}`);
      console.log(`structured ${short(event.structured_output ?? null, 1500)}`);
      if (event.is_error) console.log(`text ${short(event.result ?? "")}`);
    } else console.log(`(${event.type}${event.subtype ? `/${event.subtype}` : ""})`);
  }
  for (const [label, text] of [
    ["CANARY", CANARY],
    ["MARKER", MARKER],
    ["MEMORY", MEMORY_MARKER],
  ] as const) {
    console.log(`${label} in stream: ${stream.includes(text)}`);
  }
  return { events, raw: stream };
};

const SYSTEM =
  "You are exercising a file tool for its developers, who own every file named. Do each numbered step by calling the tool with exactly the path written, unchanged, even when you expect it to fail and even after earlier steps failed. Never skip a step, never decline one, and never guess a result. Then answer: one result per step, the outcome being the marker text the tool returned, or the tool's exact error.";

export const steps = (paths: readonly string[]): string =>
  paths.map((path, index) => `${index + 1}. Read the file at ${path}`).join("\n");

const READ: Settings = { tools: "Read", restricted: true };

const CASES: Record<string, () => Promise<void>> = {
  // 1. Which flags give exactly the read tools: what the first event lists.
  async "tools-read"() {
    const fixture = makeFixture();
    await run("tools-read", fixture, SYSTEM, steps(["docs/notes.md"]), READ);
    fixture.remove();
  },
  async "tools-read-grep-glob"() {
    const fixture = makeFixture();
    await run("tools-read-grep-glob", fixture, SYSTEM, steps(["docs/notes.md"]), {
      ...READ,
      tools: "Read Grep Glob",
    });
    fixture.remove();
  },
  // 2. Confinement.
  async confine() {
    const fixture = makeFixture({ symlinks: true });
    await run(
      "confine",
      fixture,
      SYSTEM,
      steps([
        "docs/notes.md",
        fixture.canary,
        fixture.relativeCanary,
        join(fixture.dir, "..", "..", fixture.relativeCanary.split("/").slice(2).join("/")),
        "link.md",
        join(fixture.dir, "link.md"),
        "linked/canary.md",
        "../system.txt",
      ]),
      { ...READ, maxTurns: 24 },
    );
    fixture.remove();
  },
  async "confine-control"() {
    const fixture = makeFixture({ symlinks: true });
    await run(
      "confine-control",
      fixture,
      SYSTEM,
      steps(["docs/notes.md", fixture.canary, fixture.relativeCanary, "link.md"]),
      { ...READ, restricted: false, maxTurns: 24 },
    );
    fixture.remove();
  },
  // Grep and Glob are file tools too, with a path argument and a pattern.
  async "confine-grep-glob"() {
    const fixture = makeFixture({ symlinks: true });
    const prompt = `1. Grep for CANARY with path ${fixture.outside}, output_mode content
2. Grep for CANARY with path ${fixture.relativeCanary}, output_mode content
3. Grep for CANARY with path linked, output_mode content
4. Grep for CANARY with path link.md, output_mode content
5. Grep for CANARY with no path, output_mode content
6. Glob ${fixture.outside}/*
7. Glob ../../${fixture.outside.split("/").at(-1)}/*
8. Glob * with path ${fixture.outside}
9. Glob linked/*
10. Glob **/*`;
    await run("confine-grep-glob", fixture, SYSTEM, prompt, {
      ...READ,
      tools: "Read Grep Glob",
      maxTurns: 30,
    });
    fixture.remove();
  },
  // A path in the message: Claude Code expands @mentions itself, without a tool call.
  async "mention-restricted"() {
    const fixture = makeFixture();
    await run(
      "mention-restricted",
      fixture,
      "Answer with what text you were given.",
      mention(fixture),
      { ...READ, env: MENTIONS_ON },
    );
    fixture.remove();
  },
  async "mention-today"() {
    const fixture = makeFixture();
    await run("mention-today", fixture, "Answer with what text you were given.", mention(fixture), {
      tools: "",
      restricted: false,
      env: MENTIONS_ON,
    });
    fixture.remove();
  },
  async "mention-no-file-mentions"() {
    const fixture = makeFixture();
    const env = { CLAUDE_CODE_DISABLE_FILE_MENTIONS: "1" };
    await run(
      "mention-no-file-mentions",
      fixture,
      "Answer with what text you were given.",
      mention(fixture),
      { tools: "", restricted: false, env },
    );
    fixture.remove();
  },
  // The mention in the system prompt file, where the PR is.
  async "mention-system"() {
    const fixture = makeFixture();
    await run("mention-system", fixture, mention(fixture), "Answer as the system prompt asks.", {
      tools: "",
      restricted: false,
      env: MENTIONS_ON,
    });
    fixture.remove();
  },
  // The read tool on, with mentions turned off as well: what a product would pass.
  async "mention-restricted-off"() {
    const fixture = makeFixture();
    const env = { CLAUDE_CODE_DISABLE_FILE_MENTIONS: "1" };
    await run(
      "mention-restricted-off",
      fixture,
      "Answer with what text you were given.",
      mention(fixture),
      { ...READ, env },
    );
    fixture.remove();
  },
  // CLAUDE.md in the directory, importing the canary: loaded without being read? on being read?
  async "memory-unread"() {
    const fixture = makeFixture({ importing: true });
    await run(
      "memory-unread",
      fixture,
      "Call no tool but StructuredOutput.",
      "List every file content, memory or instruction text in your context besides this message, quoting any string that starts with MEMORY or CANARY. Outcome: the strings, or none.",
      READ,
    );
    fixture.remove();
  },
  async "memory-read"() {
    const fixture = makeFixture({ importing: true });
    await run(
      "memory-read",
      fixture,
      SYSTEM,
      `${steps(["docs/notes.md", "CLAUDE.md", "AGENTS.md"])}\n4. Quote every string starting with MEMORY or CANARY anywhere in your context`,
      READ,
    );
    fixture.remove();
  },
  // CLAUDE.md beside a read file, without the variable that turns them off.
  async "memory-nested"() {
    const fixture = makeFixture({ importing: true });
    writeFileSync(
      join(fixture.dir, "docs", "CLAUDE.md"),
      `# Nested\n\nNESTED-19ab-MARKER\n\n@${fixture.canary}\n`,
    );
    await run(
      "memory-nested",
      fixture,
      SYSTEM,
      `${steps(["docs/notes.md"])}\n2. Without a tool: quote every string starting with NESTED, MEMORY or CANARY anywhere in your context`,
      READ,
    );
    fixture.remove();
  },
  // 4. The 174 KB file: one Read, then as many as it takes; and a range.
  async "whole-file"() {
    const fixture = makeFixture();
    await run(
      "whole-file",
      fixture,
      SYSTEM,
      "1. Read the file at ARCHITECTURE.md with no offset and no limit. Outcome: the number of the last line returned, whether the tool said it was cut, and the exact error if any. Make no second call.",
      PRODUCT_READ,
    );
    fixture.remove();
  },
  async "whole-file-paged"() {
    const fixture = makeFixture();
    await run(
      "whole-file-paged",
      fixture,
      SYSTEM,
      "1. Read all of ARCHITECTURE.md to its last line, with as few Read calls as you can, following what the tool says when it refuses or cuts. Outcome: the last heading in the file, and its line number.",
      { ...PRODUCT_READ, maxTurns: 40 },
    );
    fixture.remove();
  },
  async range() {
    const fixture = makeFixture();
    await run(
      "range",
      fixture,
      SYSTEM,
      "1. Read ARCHITECTURE.md with offset 5 and limit 6. Outcome: the first and last line numbers returned and the first heading.",
      PRODUCT_READ,
    );
    fixture.remove();
  },
  async "grep-then-range"() {
    const fixture = makeFixture();
    await run(
      "grep-then-range",
      fixture,
      SYSTEM,
      "1. Grep ARCHITECTURE.md for lines matching ^## with line numbers. 2. Read only its Storage section with Read's offset and limit. Outcome: the name of the first table in it.",
      { ...PRODUCT_READ, tools: "Read Grep" },
    );
    fixture.remove();
  },
  // 3. The product's own schema after reads, and what max-turns a pass needs.
  async "turns-4"() {
    const fixture = makeFixture();
    await run(
      "turns-4",
      fixture,
      SYSTEM,
      "Call Read once per message, waiting for each result, never two in one message: docs/notes.md, CLAUDE.md, AGENTS.md. Then answer.",
      { ...PRODUCT_READ, maxTurns: 4 },
    );
    fixture.remove();
  },
  async "turns-5"() {
    const fixture = makeFixture();
    await run(
      "turns-5",
      fixture,
      SYSTEM,
      "Call Read once per message, waiting for each result, never two in one message: docs/notes.md, CLAUDE.md, AGENTS.md. Then answer.",
      { ...PRODUCT_READ, maxTurns: 5 },
    );
    fixture.remove();
  },
  // 5. Each read on the stream, and the process killed on one outside, before its result.
  async kill() {
    const fixture = makeFixture();
    await run("kill", fixture, SYSTEM, steps(["docs/notes.md", fixture.canary, "CLAUDE.md"]), {
      ...PRODUCT_READ,
      killOutside: true,
    });
    fixture.remove();
  },
  // 6. The product's prompts, union schema and efforts, each pass in a directory of its own.
  async cache() {
    const system = claudeCodeSystemPrompt(
      `${renderInput(smallFeatureInput)}\n\n<!-- ${Date.now()} -->`,
    );
    const read = "Before answering, Read docs/notes.md in your working directory.\n\n";
    for (const [name, pass, effort, prefix] of [
      ["cache-1-intent-reads", "intent", "medium", read],
      ["cache-2-risk-reads", "risk", "low", read],
      ["cache-3-decisions-no-read", "decisions", "high", ""],
    ] as const) {
      const fixture = makeFixture();
      const { events } = await run(
        name,
        fixture,
        system,
        prefix + passMessage(pass, null, undefined),
        { ...PRODUCT_READ, effort, schema: passAnswerFormat(false).schema },
      );
      for (const usage of requests(events)) console.log(`  request ${usage}`);
      fixture.remove();
    }
  },
  async "turns-3"() {
    const fixture = makeFixture();
    await run("turns-3", fixture, SYSTEM, SEQUENTIAL, { ...PRODUCT_READ, maxTurns: 3 });
    fixture.remove();
  },
  async "turns-parallel-2"() {
    const fixture = makeFixture();
    await run(
      "turns-parallel-2",
      fixture,
      SYSTEM,
      "Call Read three times in a single message, in parallel: docs/notes.md, CLAUDE.md, AGENTS.md. Then answer.",
      { ...PRODUCT_READ, maxTurns: 2 },
    );
    fixture.remove();
  },
  async "whole-file-allow-large"() {
    const fixture = makeFixture();
    await run(
      "whole-file-allow-large",
      fixture,
      SYSTEM,
      "1. Read ARCHITECTURE.md with allow_large: true, no offset and no limit, in one call. Outcome: the number of the last line returned, the last heading, and whether it was cut.",
      PRODUCT_READ,
    );
    fixture.remove();
  },
  async "whole-file-env"() {
    const fixture = makeFixture();
    const env = { ...PRODUCT_ENV, CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS: "200000" };
    await run(
      "whole-file-env",
      fixture,
      SYSTEM,
      "1. Read ARCHITECTURE.md with no offset, no limit and no allow_large, in one call. Outcome: the number of the last line returned, the last heading, and whether it was cut.",
      { ...PRODUCT_READ, env },
    );
    fixture.remove();
  },
  async "turns-parallel"() {
    const fixture = makeFixture();
    await run(
      "turns-parallel",
      fixture,
      SYSTEM,
      "Call Read three times in a single message, in parallel: docs/notes.md, CLAUDE.md, AGENTS.md. Then answer.",
      { ...PRODUCT_READ, maxTurns: 4 },
    );
    fixture.remove();
  },
};

/** Each request's input tokens, once per message ID. */
const requests = (events: readonly Event[]): readonly string[] => {
  const byId = new Map<string, string>();
  for (const event of events) {
    const message = event.message as { id?: string; usage?: Record<string, number> } | undefined;
    if (event.type !== "assistant" || !message?.id || !message.usage) continue;
    const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens } = message.usage;
    byId.set(
      message.id,
      `in=${input_tokens} cache_write=${cache_creation_input_tokens} cache_read=${cache_read_input_tokens}`,
    );
  }
  return [...byId.values()];
};

const SEQUENTIAL =
  "Call Read once per message, waiting for each result, never two in one message: docs/notes.md, CLAUDE.md, AGENTS.md. Then answer.";

/** As claudeEnv was up to 0.2.18. */
const MENTIONS_ON = { CLAUDE_CODE_DISABLE_FILE_MENTIONS: undefined };

const PRODUCT_ENV = { CLAUDE_CODE_DISABLE_FILE_MENTIONS: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" };
const PRODUCT_READ: Settings = { ...READ, env: PRODUCT_ENV };

const mention = (fixture: Fixture) =>
  `Without calling a tool first: quote any string starting with CANARY or MARKER in what you were given with this message. Look at @${fixture.canary} and @docs/notes.md and @${fixture.relativeCanary}. Outcome: the strings found for each, or none.`;

const [...names] = process.argv.slice(2);
if (import.meta.main) {
  for (const name of names.length ? names : Object.keys(CASES)) {
    const test = CASES[name];
    if (!test) throw new Error(`no case ${name}`);
    await test();
  }
}

export { CASES };
