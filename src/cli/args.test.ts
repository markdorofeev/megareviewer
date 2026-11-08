import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./args.ts";

describe("parseCliArgs", () => {
  it.each([
    [[], { kind: "serve", port: 0, open: true, ai: false, checkout: null }],
    [["--port", "4823"], { kind: "serve", port: 4823, open: true, ai: false, checkout: null }],
    [["--port=0", "--no-open"], { kind: "serve", port: 0, open: false, ai: false, checkout: null }],
    [["--ai"], { kind: "serve", port: 0, open: true, ai: true, checkout: null }],
    [["doctor"], { kind: "doctor", checkout: null }],
    [["doctor", "--checkout", "../shop"], { kind: "doctor", checkout: "../shop" }],
    [
      ["--checkout=/src/shop", "--ai"],
      { kind: "serve", port: 0, open: true, ai: true, checkout: "/src/shop" },
    ],
    [["--version"], { kind: "version" }],
    [["--help"], { kind: "help" }],
    [["-h"], { kind: "help" }],
    [["doctor", "--help"], { kind: "help" }],
  ])("parses %j", (argv, command) => {
    expect(parseCliArgs(argv)).toEqual({ ok: true, value: command });
  });

  it.each([
    [["--verbose"], "Unknown option '--verbose'"],
    [["--port"], "--port"],
    [["--port", "80a"], "--port must be a number from 0 to 65535"],
    [["--port", "65536"], "--port must be a number from 0 to 65535"],
    [["--port", "-1"], "--port"],
    [["serve"], "Unknown command: serve"],
    [["doctor", "now"], "Unexpected argument: now"],
    [["doctor", "--no-open"], "doctor takes no options but --checkout"],
    [["--checkout"], "--checkout"],
    [["--checkout="], "--checkout needs a directory"],
    [["--version", "--checkout", "."], "--version takes no other arguments"],
    [["doctor", "--ai"], "doctor takes no options"],
    [["--version", "--port", "1"], "--version takes no other arguments"],
    [["doctor", "--version"], "--version takes no other arguments"],
    [["--no-open=yes"], "--no-open"],
  ])("rejects %j", (argv, message) => {
    const result = parseCliArgs(argv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});
