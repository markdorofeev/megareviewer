import { describe, expect, it } from "vitest";
import { runStructuredCall } from "./claude-code-call.ts";
import { SYSTEM_PROMPT_FILE } from "./claude-code-request.ts";
import {
  createFakeRunClaude,
  recordedLines,
  type SyntheticRun,
  syntheticLines,
} from "./fixtures/fake-run-claude.ts";

const call = {
  model: "claude-opus-5-5",
  effort: "medium",
  systemPrompt: "Grade this.\n\n<pull_request_data>…</pull_request_data>",
  schema: { type: "object", properties: { ok: { type: "boolean" } } },
  message: "The items to grade",
  onPlan: true,
} as const;

const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];

describe("runStructuredCall", () => {
  it("runs the given model, effort and schema, the prompt in the file and the message on stdin", async () => {
    const fake = createFakeRunClaude(() => recordedLines("intent"));
    const answered = await runStructuredCall(fake.run, call);
    if (!answered.ok) throw new Error(answered.error.message);
    const [made] = fake.calls;
    expect(flag(made?.args ?? [], "--model")).toBe("claude-opus-5-5");
    expect(flag(made?.args ?? [], "--effort")).toBe("medium");
    expect(JSON.parse(flag(made?.args ?? [], "--json-schema") ?? "")).toEqual(call.schema);
    expect(flag(made?.args ?? [], "--tools")).toBe("");
    expect(made?.options.files?.[SYSTEM_PROMPT_FILE]).toBe(call.systemPrompt);
    expect(made?.options.stdin).toBe(call.message);
    expect(answered.value).toMatchObject({
      answer: { answer: { pass: "intent" } },
      version: "2.1.303",
      models: ["claude-haiku-5-5"],
    });
  });

  it("names the model the session started on first", async () => {
    const [init = "", ...rest] = recordedLines("intent");
    const fake = createFakeRunClaude(() => [
      JSON.stringify({ ...JSON.parse(init), model: "claude-opus-5-5" }),
      ...rest,
    ]);
    const answered = await runStructuredCall(fake.run, call);
    if (!answered.ok) throw new Error(answered.error.message);
    expect(answered.value.models).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
  });

  it.each<SyntheticRun>(["tools", "mcp-server", "api-key"])(
    "stops a session with %s before it answers",
    async (name) => {
      const fake = createFakeRunClaude(() => [
        ...syntheticLines(name),
        ...recordedLines("intent").slice(1),
      ]);
      const answered = await runStructuredCall(fake.run, call);
      expect(fake.calls[0]?.result.killed).toBe("rejected");
      if (answered.ok) throw new Error("expected the call to fail");
      expect(answered.error.message).toMatch(/wasn't locked down/);
    },
  );

  it("fails an answer without the session's first event", async () => {
    const fake = createFakeRunClaude(() => recordedLines("intent").slice(1));
    const answered = await runStructuredCall(fake.run, call);
    if (answered.ok) throw new Error("expected the call to fail");
    expect(answered.error.message).toMatch(/no session/);
  });

  describe("with something to read", () => {
    const reading = {
      ...call,
      readable: new Map([
        ["harness/CLAUDE.md", "# Shop"],
        ["harness/docs/rules.md", "# Rules"],
        ["harness/docs/plan.md", "# Plan"],
      ]),
    };

    it("writes the files beside where the session runs, with the prompt out of its reach", async () => {
      const fake = createFakeRunClaude(() => recordedLines("reads"));
      const answered = await runStructuredCall(fake.run, reading);
      if (!answered.ok) throw new Error(answered.error.message);
      const [made] = fake.calls;
      expect(flag(made?.args ?? [], "--tools")).toBe("Read Grep");
      expect(made?.args).toContain("--restricted");
      expect(flag(made?.args ?? [], "--max-turns")).toBe("10");
      expect(flag(made?.args ?? [], "--system-prompt-file")).toBe("../system.txt");
      expect(made?.options.workDir).toBe("work");
      expect(made?.options.files).toEqual({
        "system.txt": call.systemPrompt,
        "work/harness/CLAUDE.md": "# Shop",
        "work/harness/docs/rules.md": "# Rules",
        "work/harness/docs/plan.md": "# Plan",
      });
      expect(answered.value.reads).toHaveLength(7);
    });

    it("stops a session on a read outside its directory, before its answer, and says what it read", async () => {
      const fake = createFakeRunClaude(() => recordedLines("read-outside"));
      const answered = await runStructuredCall(fake.run, reading);
      expect(fake.calls[0]?.result.killed).toBe("rejected");
      expect(answered).toMatchObject({
        ok: false,
        error: {
          kind: "reader",
          message:
            "The pass was stopped: it tried to read /outside/canary.md, which isn't one of the harness's files.",
          reads: [
            { path: "harness/docs/plan.md", outcome: "read" },
            { path: "/outside/canary.md", outcome: "refused" },
          ],
        },
      });
    });

    it.each([
      ["without its read tools", () => recordedLines("intent"), /no Read tool/],
      ["with a tool beside them", () => [...syntheticLines("tools")], /had tools/],
      ["with an MCP server", () => [...syntheticLines("mcp-server")], /no Read tool|MCP servers/],
    ])("fails the reading of a session %s, which is tried again without", async (_, lines, why) => {
      const answered = await runStructuredCall(createFakeRunClaude(lines).run, reading);
      if (answered.ok) throw new Error("expected the call to fail");
      expect(answered.error.kind).toBe("reader");
      expect(answered.error.message).toMatch(why);
    });

    const ending = (result: object): string[] => [
      ...recordedLines("reads").slice(0, -1),
      JSON.stringify({
        type: "result",
        is_error: true,
        total_cost_usd: 0.01,
        usage: { input_tokens: 1, output_tokens: 1 },
        ...result,
      }),
    ];

    it.each([
      ["that runs out of rounds", { subtype: "error_max_turns" }, /used up its rounds/],
      [
        "whose reads don't fit the window",
        { subtype: "error", result: "Prompt is too long" },
        /didn't fit/,
      ],
    ])("fails the reading of a session %s", async (_, result, why) => {
      const answered = await runStructuredCall(
        createFakeRunClaude(() => ending(result)).run,
        reading,
      );
      if (answered.ok) throw new Error("expected the call to fail");
      expect(answered.error.kind).toBe("reader");
      expect(answered.error.message).toMatch(why);
      expect(answered.error.reads).toHaveLength(7);
    });

    it("keeps any other failure what it is, with what was read", async () => {
      const answered = await runStructuredCall(
        createFakeRunClaude(() => ending({ api_error_status: 529, result: "Overloaded" })).run,
        reading,
      );
      expect(answered).toMatchObject({ ok: false, error: { kind: "overloaded" } });
      expect(!answered.ok && answered.error.reads).toHaveLength(7);
    });

    it("fails the reading when the files can't be written, and throws without any to write", async () => {
      const failing = async () => {
        throw new Error("EEXIST: file already exists");
      };
      expect(await runStructuredCall(failing, reading)).toEqual({
        ok: false,
        error: {
          kind: "reader",
          message: "The harness's files couldn't be written: EEXIST: file already exists",
        },
      });
      await expect(runStructuredCall(failing, call)).rejects.toThrow("EEXIST");
    });

    it("has neither the tools nor the reads without any", async () => {
      const fake = createFakeRunClaude(() => recordedLines("intent"));
      const answered = await runStructuredCall(fake.run, { ...call, readable: null });
      expect(flag(fake.calls[0]?.args ?? [], "--max-turns")).toBe("4");
      expect(fake.calls[0]?.args).not.toContain("--restricted");
      expect(fake.calls[0]?.options.workDir).toBeUndefined();
      expect(answered.ok && answered.value.reads).toEqual([]);
    });
  });
});
