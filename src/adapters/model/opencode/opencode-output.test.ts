import { describe, expect, it } from "vitest";
import { HARNESS_DIR, recorded, recordedReads } from "./fixtures/fake-opencode-client.ts";
import { type PassHarness, readTurn } from "./opencode-output.ts";

/** The spike's harness files, which the recorded sessions were given leave to read. */
const harness: PassHarness = {
  directory: HARNESS_DIR,
  files: new Set(["ARCHITECTURE.md", "CLAUDE.md", "AGENTS.md", "docs/notes.md"]),
};

/** A turn with its reads cut to what they are, leaving the log out. */
const turnOf = (json: unknown, given: PassHarness | null = harness) => {
  const turn = readTurn(json, given);
  if (turn === null) throw new Error("the messages didn't parse");
  return {
    ...turn,
    reads: turn.reads.map(({ path, fromLine, toLine, outcome }) => ({
      path,
      fromLine,
      toLine,
      outcome,
    })),
  };
};

const logOf = (json: unknown, given: PassHarness = harness) =>
  (readTurn(json, given)?.reads ?? []).map(({ path, round, tool, chars, reason }) => ({
    path,
    round,
    tool,
    chars,
    reason,
  }));

const read = (path: string, lines: readonly [number, number] | null = null) => ({
  path,
  fromLine: lines?.[0] ?? null,
  toLine: lines?.[1] ?? null,
  outcome: "read",
});
const refused = (path: string) => ({ ...read(path), outcome: "refused" });

const assistant = (...content: Record<string, unknown>[]) => ({ type: "assistant", content });
const tool = (name: string, state: Record<string, unknown>) => ({
  type: "tool",
  id: "t",
  name,
  state,
});

describe("readTurn with a harness", () => {
  it("reads the files of several messages and takes the answer from the last", () => {
    const turn = turnOf(recordedReads("reads-answer"));
    expect(turn.reads).toEqual([read("docs/notes.md"), read("CLAUDE.md")]);
    expect(turn.tools).toEqual([]);
    expect(turn.rounds).toBe(2);
    expect(turn.text).toMatch(/^\{"answer":\{"pass":"intent"/);
    expect(turn.finish).toBe("stop");
  });

  it("adds up the tokens and the cost of every message", () => {
    const turn = turnOf(recordedReads("reads-range"));
    expect(turn.tokens).toEqual({
      inputTokens: 6,
      cacheReadTokens: 1803 + 2427,
      cacheWriteTokens: 624 + 372,
      outputTokens: 100 + 89 + 47,
    });
    expect(turn.costUsd).toBeCloseTo(0.0002854, 8);
  });

  it("keeps the lines of a read by lines", () => {
    expect(turnOf(recordedReads("reads-range")).reads).toEqual([
      read("ARCHITECTURE.md", [404, 411]),
    ]);
  });

  it("keeps a refused read of the directory, and fails on one outside it, refused or not", () => {
    const turn = turnOf(recordedReads("reads-refused"));
    expect(turn.reads).toEqual([
      read("docs/notes.md"),
      refused("/tmp/outside/canary.md"),
      refused("/outside/canary.md"),
      refused("link.md"),
      refused("link.md"),
      refused("linked/canary.md"),
      read("CLAUDE.md"),
    ]);
    expect(turn.tools).toEqual(["read of /tmp/outside/canary.md", "read of /outside/canary.md"]);
  });

  it("logs each read's round, what it gave, and why one was refused", () => {
    expect(logOf(recordedReads("reads-answer"))).toEqual([
      { path: "docs/notes.md", round: 1, tool: "read", chars: 88, reason: undefined },
      { path: "CLAUDE.md", round: 2, tool: "read", chars: 136, reason: undefined },
    ]);
    expect(logOf(recordedReads("reads-refused")).slice(0, 2)).toEqual([
      { path: "docs/notes.md", round: 1, tool: "read", chars: 88, reason: undefined },
      {
        path: "/tmp/outside/canary.md",
        round: 1,
        tool: "read",
        chars: undefined,
        reason: "Permission denied: external_directory",
      },
    ]);
    const inside = { ...harness, files: new Set([...harness.files, "docs/AGENTS.md"]) };
    expect(logOf(recordedReads("reads-nested"), inside)[1]).toEqual({
      path: "docs/AGENTS.md",
      round: 1,
      tool: "loaded",
      chars: undefined,
      reason: undefined,
    });
  });

  it("fails on another tool", () => {
    expect(turnOf(recordedReads("reads-grep")).tools).toEqual(Array(6).fill("grep"));
  });

  it("counts an AGENTS.md that loaded itself as a read, when it's a file of the harness", () => {
    const nested = recordedReads("reads-nested");
    const inside = { ...harness, files: new Set([...harness.files, "docs/AGENTS.md"]) };
    expect(turnOf(nested, inside)).toMatchObject({
      tools: [],
      reads: [read("docs/notes.md"), read("docs/AGENTS.md")],
    });
    expect(turnOf(nested)).toMatchObject({ tools: ["synthetic"], reads: [read("docs/notes.md")] });
    const elsewhere = recordedReads("reads-nested", "/tmp/another");
    expect(turnOf(elsewhere, inside).tools).toEqual(["synthetic"]);
  });

  it("fails on a message opencode adds of itself that loads nothing", () => {
    const turn = turnOf({
      data: [{ type: "synthetic", text: "You may use the shell.", metadata: {} }, assistant()],
    });
    expect(turn.tools).toEqual(["synthetic"]);
  });

  it("fails on a file that ran through and isn't the harness's", () => {
    const ran = (path: string) =>
      turnOf({
        data: [assistant(tool("read", { status: "completed", input: { path }, content: [] }))],
      }).tools;
    expect(ran("docs/other.md")).toEqual(["read of docs/other.md"]);
    expect(ran(HARNESS_DIR)).toEqual(["read of ."]);
    expect(ran("../outside/canary.md")).toEqual(["read of /tmp/outside/canary.md"]);
    expect(ran("~/.ssh/id_rsa")).toEqual(["read of ~/.ssh/id_rsa"]);
    expect(ran("file:///etc/passwd")).toEqual(["read of file:///etc/passwd"]);
    expect(ran(`${HARNESS_DIR}-next/CLAUDE.md`)).toEqual([`read of ${HARNESS_DIR}-next/CLAUDE.md`]);
    expect(ran(`${HARNESS_DIR}/docs/notes.md`)).toEqual([]);
  });

  it("fails on a read that names no path, and counts one that never ran as refused", () => {
    const turn = turnOf({
      data: [
        assistant(
          tool("read", { status: "completed", input: {} }),
          tool("read", { status: "streaming", input: "{" }),
          tool("read", { status: "running", input: { path: "CLAUDE.md" }, metadata: {} }),
        ),
      ],
    });
    expect(turn.tools).toEqual(["read"]);
    expect(turn.reads).toEqual([refused("CLAUDE.md")]);
  });

  it("takes a first page cut short for the lines it gave, and one it can't place for the whole", () => {
    const reading = (text: string, truncated: boolean) =>
      turnOf({
        data: [
          assistant(
            tool("read", {
              status: "completed",
              input: { path: "CLAUDE.md" },
              content: [{ type: "text", text }],
              metadata: { truncated },
            }),
          ),
        ],
      }).reads;
    expect(reading("Read file CLAUDE.md, lines 1-221\n1: # A", true)).toEqual([
      read("CLAUDE.md", [1, 221]),
    ]);
    expect(reading("Read file CLAUDE.md, lines 1-221\n1: # A", false)).toEqual([read("CLAUDE.md")]);
    expect(reading("# A\nRead file CLAUDE.md, lines 4-6", false)).toEqual([read("CLAUDE.md")]);
  });
});

describe("readTurn without a harness", () => {
  it("allows no read and no second step, as before", () => {
    expect(turnOf(recordedReads("reads-answer"), null).tools).toEqual(["read", "read", "3 steps"]);
    expect(turnOf(recorded("intent"), null)).toMatchObject({ tools: [], reads: [], rounds: 0 });
  });
});
