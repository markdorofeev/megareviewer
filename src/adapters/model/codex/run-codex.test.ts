import { describe, expect, it } from "vitest";
import { codexEnv, createRunCodex } from "./run-codex.ts";

describe("codexEnv", () => {
  it("keeps CODEX_HOME and drops keys, base URLs and Codex's other variables", () => {
    expect(
      codexEnv({
        PATH: "/bin",
        HOME: "/home/me",
        CODEX_HOME: "/home/me/.codex-work",
        CODEX_API_KEY: "key",
        CODEX_SANDBOX: "seatbelt",
        OPENAI_API_KEY: "key",
        OPENAI_BASE_URL: "http://proxy",
      }),
    ).toEqual({ PATH: "/bin", HOME: "/home/me", CODEX_HOME: "/home/me/.codex-work" });
  });
});

describe("runCodex", () => {
  it("gives the arguments the run's directory, with its files and an empty work directory", async () => {
    const run = createRunCodex({ command: process.execPath });
    const result = await run(
      (dir) => [
        "-e",
        `const fs = require("node:fs");
         console.log(JSON.stringify({
           dir: fs.realpathSync(process.argv[1]),
           cwd: process.cwd(),
           files: fs.readdirSync(".").sort(),
           work: fs.readdirSync("work"),
           key: process.env.CODEX_API_KEY ?? null,
         }));`,
        dir,
      ],
      { files: { "instructions.md": "the prompt" }, dirs: ["work"] },
    );
    const said = JSON.parse(result.lines[0] ?? "{}");
    expect(said.dir).toBe(said.cwd);
    expect(said.files).toEqual(["instructions.md", "work"]);
    expect(said.work).toEqual([]);
    expect(said.key).toBeNull();
  });
});
