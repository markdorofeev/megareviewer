import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claudeEnv, createRunClaude } from "./run-claude.ts";

// Node stands in for `claude`: the arguments are a script and what it reads.
const node = (options: { timeoutMs?: number; signal?: AbortSignal } = {}) =>
  createRunClaude({ command: process.execPath, ...options });
const script = (code: string) => ["-e", code];

describe("claudeEnv", () => {
  it("drops credentials, base URLs and a parent Claude Code session's variables", () => {
    const env = claudeEnv({
      PATH: "/bin",
      HOME: "/home/me",
      ANTHROPIC_API_KEY: "key",
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_BASE_URL: "http://proxy",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "sdk",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_DISABLE_FILE_MENTIONS: "0",
      CLAUDE_CONFIG_DIR: "/home/me/.claude-work",
    });
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/home/me",
      CLAUDE_CONFIG_DIR: "/home/me/.claude-work",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_DISABLE_FILE_MENTIONS: "1",
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS: "60000",
    });
  });

  it("turns off @ mentions, which read files off the stream, whatever the server's environment", () => {
    expect(claudeEnv({})).toHaveProperty("CLAUDE_CODE_DISABLE_FILE_MENTIONS", "1");
    expect(claudeEnv({ CLAUDE_CODE_DISABLE_FILE_MENTIONS: "" })).toHaveProperty(
      "CLAUDE_CODE_DISABLE_FILE_MENTIONS",
      "1",
    );
  });
});

describe("runClaude", () => {
  it("runs in a new directory holding the files, removed afterwards, with stdin and lines", async () => {
    const run = await node()(
      script(`
        const fs = require("node:fs");
        let input = "";
        process.stdin.on("data", (c) => (input += c));
        process.stdin.on("end", () => {
          console.log(JSON.stringify({ cwd: process.cwd(), files: fs.readdirSync("."), input }));
          console.log(JSON.stringify({ key: process.env.ANTHROPIC_API_KEY ?? null }));
          console.error("a warning");
        });
      `),
      { stdin: "the message", files: { "system.txt": "the prompt" } },
    );
    expect(run).toMatchObject({ code: 0, started: true, killed: null, stderr: "a warning" });
    const [first, second] = run.lines.map((line) => JSON.parse(line));
    expect(first.files).toEqual(["system.txt"]);
    expect(first.input).toBe("the message");
    expect(second.key).toBeNull();
    expect(existsSync(first.cwd)).toBe(false);
  });

  it("runs where asked in that directory, beside files at their own paths", async () => {
    let cwd = "";
    const run = await node()(
      script(`
        const fs = require("node:fs");
        console.log(JSON.stringify({
          cwd: process.cwd(),
          above: fs.readdirSync("..").sort(),
          rules: fs.readFileSync("harness/docs/rules.md", "utf8"),
          regular: fs.lstatSync("harness/docs/rules.md").isFile(),
        }));
      `),
      {
        files: { "system.txt": "the prompt", "work/harness/docs/rules.md": "# Rules" },
        workDir: "work",
        onStart(dir) {
          cwd = dir;
        },
      },
    );
    const [first] = run.lines.map((line) => JSON.parse(line));
    expect(first).toEqual({
      cwd,
      above: ["system.txt", "work"],
      rules: "# Rules",
      regular: true,
    });
    expect(existsSync(cwd)).toBe(false);
  });

  it.each([
    ["outside the directory", { "../escaped.md": "x" }, /isn't in the directory/],
    ["over another", { "a/b.md": "x", "./a/b.md": "y" }, /EEXIST/],
  ])("refuses to write a file %s", async (_, files, why) => {
    await expect(node()(script(""), { files })).rejects.toThrow(why);
  });

  it("kills the process when a line is rejected", async () => {
    const run = await node()(
      script(`console.log("init"); setTimeout(() => console.log("answer"), 5000);`),
      { onLine: (line) => (line === "init" ? "stop" : "continue") },
    );
    expect(run).toMatchObject({ code: null, killed: "rejected", lines: ["init"] });
  });

  it("kills the process when it runs too long", async () => {
    const run = await node({ timeoutMs: 100 })(script("setTimeout(() => {}, 5000);"));
    expect(run.killed).toBe("timeout");
  });

  it("kills the process when the server closes", async () => {
    const controller = new AbortController();
    const running = node({ signal: controller.signal })(script("setTimeout(() => {}, 5000);"));
    setTimeout(() => controller.abort(), 100);
    expect((await running).killed).toBe("closed");
  });

  it("says when the command can't be started", async () => {
    const run = await createRunClaude({ command: "megareviewer-no-such-command" })([]);
    expect(run).toMatchObject({ started: false, code: null, lines: [] });
  });
});
