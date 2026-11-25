import { stat } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { InputHarness } from "../../../application/ports/index.ts";
import {
  describeAnalysisModelContract,
  RecordingLogger,
  smallFeatureInput,
  smallFeatureIntent,
} from "../../../application/testing/index.ts";
import type { ModelErrorKind } from "../../../domain/review/index.ts";
import { ok } from "../../../domain/shared/index.ts";
import { withGuidance } from "../shared/fixtures/guidance.ts";
import {
  createFakeOpencodeClient,
  recorded,
  recordedReads,
  sessionWith,
} from "./fixtures/fake-opencode-client.ts";
import {
  createOpencodeAnalysisModel,
  OVERHEAD_TOKENS,
  runOpencodeCall,
} from "./opencode-analysis-model.ts";
import type { OpencodeClient } from "./opencode-client.ts";
import { readTurn } from "./opencode-output.ts";
import { AGENT, PR_ENTRY } from "./opencode-request.ts";

const HAIKU_VARIANTS = ["none", "low", "medium", "high", "xhigh", "max"];

const guidedInput = withGuidance(smallFeatureInput);

const modelWith = (
  answer?: Parameters<typeof createFakeOpencodeClient>[0],
  options: {
    priced?: boolean;
    contextTokens?: number;
    wait?: (id: string) => Promise<void>;
    roundsPollMs?: number;
  } = {},
) => {
  const fake = createFakeOpencodeClient(
    answer,
    options.wait === undefined ? {} : { wait: options.wait },
  );
  const logger = new RecordingLogger();
  const model = createOpencodeAnalysisModel({
    client: fake.client,
    // The fixtures were recorded on Haiku 5.5 through the Anthropic provider.
    providerID: "anthropic",
    model: "claude-haiku-5-5",
    variants: HAIKU_VARIANTS,
    contextTokens: options.contextTokens ?? 1_000_000,
    priced: options.priced ?? true,
    ...(options.roundsPollMs === undefined ? {} : { roundsPollMs: options.roundsPollMs }),
    logger,
  });
  return { model, calls: fake.calls, logger };
};

describeAnalysisModelContract("opencode", () => modelWith().model);

/** The recorded intent session with its answer's text replaced. */
const intentSaying = (text: string) =>
  sessionWith("intent", (messages) =>
    messages.map((message) =>
      message.type === "assistant" ? { ...message, content: [{ type: "text", text }] } : message,
    ),
  );

/** The recorded intent session with `items` added to its answer. */
const intentAlso = (...items: Record<string, unknown>[]) =>
  sessionWith("intent", (messages) =>
    messages.map((message) =>
      message.type === "assistant" && Array.isArray(message.content)
        ? { ...message, content: [...items, ...message.content] }
        : message,
    ),
  );

const intentWith = async (answer: unknown) => {
  const setup = modelWith(() => answer);
  return { ...setup, result: await setup.model.intent(smallFeatureInput) };
};

const expectFailure = async (answer: unknown, kind: ModelErrorKind, message?: RegExp) => {
  const { result, calls } = await intentWith(answer);
  if (result.ok) throw new Error("expected the pass to fail");
  expect(result.error.kind).toBe(kind);
  if (message !== undefined) expect(result.error.message).toMatch(message);
  return calls;
};

const recordedIntentText = () => {
  const text = readTurn(recorded("intent"))?.text;
  if (text === undefined || text === null) throw new Error("no answer in the recorded intent");
  return text;
};

describe("OpencodeAnalysisModel", () => {
  it("has a version of its own that names the provider and model", () => {
    expect(modelWith().model.version).toMatch(/^opencode\/anthropic\/claude-haiku-5-5\/p\d+$/);
  });

  it("runs every pass as megareviewer's agent, the PR in the same entry, each at its effort", async () => {
    const { model, calls } = modelWith();
    await model.intent(smallFeatureInput);
    await model.findings(smallFeatureInput, smallFeatureIntent);
    await model.risk(smallFeatureInput);

    const created = calls.filter((call) => call.method === "POST" && call.path === "/api/session");
    expect(created.map((call) => call.body)).toEqual(
      ["medium", "high", "low"].map((variant) => ({
        agent: AGENT,
        title: "megareviewer",
        model: { providerID: "anthropic", id: "claude-haiku-5-5", variant },
      })),
    );
    const entries = calls.filter((call) => call.path.endsWith(`/entries/${PR_ENTRY}-00`));
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((call) => JSON.stringify(call.body))).size).toBe(1);
    expect(JSON.stringify(entries[0]?.body)).toContain("<pull_request_data>");

    const prompts = calls.filter((call) => call.path.endsWith("/prompt"));
    expect(JSON.stringify(prompts[1]?.body)).toMatch(/Task: findings\./);
    expect(JSON.stringify(prompts[1]?.body)).toContain("<earlier_results>");
    expect(JSON.stringify(prompts[1]?.body)).toContain('\\"const\\":\\"findings\\"');
    expect(JSON.stringify(prompts[1]?.body)).not.toContain('\\"const\\":\\"intent\\"');
    expect(JSON.stringify(prompts[2]?.body)).not.toContain("<earlier_results>");
  });

  it("puts the reviewer's guidance in the PR's entry, before the PR, and asks for its mark", async () => {
    const { model, calls } = modelWith();
    await model.findings(guidedInput, smallFeatureIntent);
    await model.risk(guidedInput);
    const entries = calls
      .filter((call) => call.path.endsWith(`/entries/${PR_ENTRY}-00`))
      .map((call) => JSON.stringify(call.body));
    expect(entries[0]).toContain(
      "<reviewer_guidance>\\n<preferences>\\np1 look-for (everywhere): ",
    );
    expect(entries[0]?.indexOf("<reviewer_guidance>")).toBeLessThan(
      entries[0]?.indexOf("<pull_request_data>") ?? 0,
    );
    expect(entries[1]).toBe(entries[0]);
    for (const prompt of calls.filter((call) => call.path.endsWith("/prompt"))) {
      expect(JSON.stringify(prompt.body)).toContain('\\"enum\\":[\\"raised\\",\\"left-out\\"]');
    }
  });

  it("returns the guidance a finding names in its answer's text", async () => {
    const marked = sessionWith("findings", (messages) =>
      messages.map((message) =>
        message.type === "assistant"
          ? {
              ...message,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    answer: {
                      pass: "findings",
                      findings: [
                        {
                          title: "Serves another tenant's receipt",
                          explanation: "`findOrder` has no tenant filter.",
                          lines: {
                            hunkId: smallFeatureInput.files[0]?.hunks[0]?.id,
                            side: "new",
                            startLine: 1,
                            line: 1,
                          },
                          severity: "blocking",
                          suggestion: null,
                          mismatch: null,
                          guidance: { ref: "p1", effect: "raised" },
                        },
                      ],
                    },
                  }),
                },
              ],
            }
          : message,
      ),
    );
    const result = await modelWith(() => marked).model.findings(guidedInput, smallFeatureIntent);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.value.map((finding) => finding.guidance)).toEqual([
      { ref: "p1", effect: "raised" },
    ]);
  });

  it("deletes each pass's session, answered or not", async () => {
    const answered = modelWith();
    await answered.model.intent(smallFeatureInput);
    expect(answered.calls.at(-1)).toMatchObject({
      method: "DELETE",
      path: "/api/session/ses_fake1",
    });

    const calls = await expectFailure(recorded("provider-error"), "unexpected");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/api/session/ses_fake1" });
  });

  it("reports what the pass used and what opencode says it cost, billed to the reviewer's key", async () => {
    const { result } = await intentWith(recorded("intent"));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.usage).toEqual({
      pass: "intent",
      inputTokens: 4,
      cacheReadTokens: expect.any(Number),
      cacheWriteTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      costUsd: expect.any(Number),
      billing: "api",
    });
    expect(result.value.usage.costUsd).toBeGreaterThan(0);
  });

  it("leaves the cost unknown for a model opencode doesn't price", async () => {
    const setup = modelWith(undefined, { priced: false });
    const result = await setup.model.intent(smallFeatureInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.usage.costUsd).toBeNull();
  });

  it("reads an answer wrapped in a code fence or a sentence", async () => {
    const json = recordedIntentText();
    for (const text of [`\`\`\`json\n${json}\n\`\`\``, `Here is the answer:\n${json}`]) {
      const { result } = await intentWith(intentSaying(text));
      expect(result.ok).toBe(true);
    }
  });

  it("fails an answer that isn't JSON, or isn't the pass's, as invalid output", async () => {
    await expectFailure(intentSaying("I can't do that."), "invalid-output", /one JSON object/);
    await expectFailure(
      intentSaying('{"answer":{"pass":"risk","assessments":[]}}'),
      "invalid-output",
      /answered the risk task instead of intent/,
    );
  });

  describe("lockdown", () => {
    it.each<[string, unknown]>([
      [
        "a tool call",
        intentAlso({ type: "tool", id: "t1", name: "skill", executed: false, state: {} }),
      ],
      ["a content item of a kind it doesn't know", intentAlso({ type: "image" })],
      [
        "a shell",
        sessionWith("intent", (messages) => [
          { type: "shell", command: "curl http://127.0.0.1:8766", status: "exited" },
          ...messages,
        ]),
      ],
      [
        "a skill loaded",
        sessionWith("intent", (messages) => [
          { type: "skill", name: "deploy", text: "…" },
          ...messages,
        ]),
      ],
      [
        "a second step",
        sessionWith("intent", (messages) => [
          ...messages,
          ...messages.filter((message) => message.type === "assistant"),
        ]),
      ],
    ])("discards the answer of a session with %s", async (_, session) => {
      const calls = await expectFailure(session, "unexpected", /used a tool/);
      expect(calls.at(-1)?.method).toBe("DELETE");
    });

    it("keeps the answer of a session with only reasoning and text", async () => {
      const { result } = await intentWith(intentAlso({ type: "reasoning", text: "thinking" }));
      expect(result.ok).toBe(true);
    });
  });

  describe("errors", () => {
    it("passes the provider's own failure through", async () => {
      await expectFailure(recorded("provider-error"), "unexpected", /assistant message prefill/);
      await expectFailure(recorded("unreachable"), "network", /can't reach the provider/);
    });

    it.each<[Record<string, unknown>, ModelErrorKind]>([
      [{ type: "provider.auth", message: "invalid x-api-key", status: 401 }, "unauthorized"],
      [{ type: "provider.rate-limit", message: "Too many requests", status: 429 }, "rate-limited"],
      [
        { type: "provider.context-overflow", message: "prompt is too long", status: 400 },
        "too-large",
      ],
      [{ type: "provider.overloaded", message: "Overloaded", status: 529 }, "overloaded"],
      [{ type: "provider.content-filter", message: "blocked" }, "refusal"],
    ])("maps %o to %s", async (error, kind) => {
      await expectFailure(
        sessionWith("intent", (messages) =>
          messages.map((message) =>
            message.type === "assistant" ? { ...message, content: [], error } : message,
          ),
        ),
        kind,
      );
    });

    it("says an answer cut off at the output limit is", async () => {
      await expectFailure(
        sessionWith("intent", (messages) =>
          messages.map((message) =>
            message.type === "assistant" ? { ...message, finish: "length" } : message,
          ),
        ),
        "max-tokens",
      );
    });

    it("stops a pass that doesn't finish, and says so", async () => {
      const calls = await expectFailure({ fail: { kind: "timeout" } }, "unexpected", /10 minutes/);
      expect(calls.map((call) => call.path)).toContain("/api/session/ses_fake1/interrupt");
    });

    it("says how to install opencode when it isn't", async () => {
      await expectFailure(
        { fail: { kind: "server", problem: { kind: "not-installed", message: "x" } } },
        "unauthorized",
        /isn't installed/,
      );
    });
  });

  describe("with a harness", () => {
    const harness: InputHarness = {
      files: ["docs/notes.md", "CLAUDE.md"].map((path, index) => ({
        ref: `g${index + 1}`,
        path: `harness/${path}`,
        bytes: 10,
        lines: 3,
        linkedFrom: null,
        headings: [],
      })),
      contents: new Map([
        ["harness/docs/notes.md", "# Notes"],
        ["harness/CLAUDE.md", "# Rules"],
      ]),
    };
    const input = { ...smallFeatureInput, harness };
    const Created = z.object({
      location: z.object({ directory: z.string() }),
      permissions: z.array(z.record(z.string(), z.string())),
    });
    const sessionsOf = (calls: ReturnType<typeof modelWith>["calls"]) =>
      calls
        .filter((call) => call.method === "POST" && call.path === "/api/session")
        .map((call) => call.body);

    /** The recorded session of two reads and an answer, its paths under `harness/`. */
    const readingIntent = (): unknown =>
      JSON.parse(
        JSON.stringify(recordedReads("reads-answer"))
          .replaceAll('"path":"docs/', '"path":"harness/docs/')
          .replaceAll('"path":"CLAUDE', '"path":"harness/CLAUDE'),
      );
    const rounds = (count: number) => ({
      data: Array.from({ length: count }, (_, index) => ({
        type: "assistant",
        finish: "tool-calls",
        content: [
          {
            type: "tool",
            id: `t${index}`,
            name: "read",
            state: { status: "completed", input: { path: "harness/CLAUDE.md" }, content: [] },
          },
        ],
      })),
    });

    it("reads it", () => {
      expect(modelWith().model.readsHarness).toBe(true);
    });

    it("gives every pass one directory, gone afterwards, and leave to read each file by name", async () => {
      const { model, calls } = modelWith();
      await model.intent(input);
      await Promise.all([model.risk(input), model.decisions(input)]);

      const sessions = sessionsOf(calls).map((body) => Created.parse(body));
      expect(sessions).toHaveLength(3);
      expect(new Set(sessions.map((session) => session.location.directory)).size).toBe(1);
      for (const { permissions, location } of sessions) {
        expect(permissions).toEqual([
          { action: "read", resource: "harness/docs/notes.md", effect: "allow" },
          { action: "read", resource: "harness/CLAUDE.md", effect: "allow" },
        ]);
        await expect(stat(location.directory)).rejects.toThrow("ENOENT");
      }
    });

    it("asks for the reading after the task, and lists the files before the PR", async () => {
      const { model, calls } = modelWith();
      await model.decisions(input);
      const bodyOf = (suffix: string) =>
        JSON.stringify(calls.find((call) => call.path.endsWith(suffix))?.body);
      expect(bodyOf("/prompt")).toContain("First go through <readable_files>");
      expect(bodyOf(`/entries/${PR_ENTRY}-00`)).toContain("harness/docs/notes.md");
    });

    it("returns what the pass read beside its answer, from every message of the session", async () => {
      const { model, calls } = modelWith(() => readingIntent());
      const result = await model.intent(input);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.value.inferred).not.toBeNull();
      expect(result.value.reads?.map(({ path, outcome }) => [path, outcome])).toEqual([
        ["harness/docs/notes.md", "read"],
        ["harness/CLAUDE.md", "read"],
      ]);
      const pages = calls.filter((call) => call.path.endsWith("/message"));
      expect(pages[0]?.query).toBe("order=asc&limit=200");
    });

    it("follows the messages to the last page, which is empty", async () => {
      const fake = createFakeOpencodeClient();
      const pages = [
        { data: rounds(1).data, cursor: { next: "two" } },
        { data: rounds(1).data, cursor: { next: "three" } },
        { data: [{ type: "idle", outcome: "succeeded" }], cursor: { next: "four" } },
        { data: [], cursor: {} },
      ];
      const queries: string[] = [];
      const client: OpencodeClient = {
        async request(method, path, request) {
          if (!path.includes("/message?")) return fake.client.request(method, path, request);
          queries.push(path.split("?")[1] ?? "");
          return ok(pages[queries.length - 1]);
        },
      };
      const result = await runOpencodeCall(
        client,
        { session: {}, entries: [], prompt: "Task: intent." },
        1_000,
        { harness: { directory: "/tmp/run", files: new Set(["harness/CLAUDE.md"]) } },
      );
      expect(queries).toEqual([
        "order=asc&limit=200",
        "cursor=two&limit=200",
        "cursor=three&limit=200",
        "cursor=four&limit=200",
      ]);
      expect(result.ok ? [] : result.error.reads).toHaveLength(2);
    });

    it("discards the answer of a pass that read outside or used another tool, for a run without the reader", async () => {
      for (const name of ["reads-refused", "reads-grep"] as const) {
        const { model, calls } = modelWith(() => recordedReads(name));
        const result = await model.intent(input);
        expect(result.ok ? null : result.error.kind).toBe("reader");
        expect(result.ok ? null : result.error.message).toMatch(/used a tool/);
        expect(calls.at(-1)?.method).toBe("DELETE");
      }
    });

    it("runs a pass without the reader as one with nothing to read", async () => {
      const without = modelWith();
      await without.model.risk(input, { withoutReader: true });
      const plain = modelWith();
      await plain.model.risk(smallFeatureInput);
      expect(without.calls).toEqual(plain.calls);
      expect(Created.safeParse(sessionsOf(without.calls)[0]).success).toBe(false);
    });

    it("runs on when the files can't be written, without the reader", async () => {
      const broken = { ...harness, contents: new Map([["../out.md", "x"]]) };
      const { model, calls } = modelWith();
      const result = await model.intent({ ...smallFeatureInput, harness: broken });
      expect(result.ok ? null : result.error).toMatchObject({
        kind: "reader",
        message: "The harness's files couldn't be written: ../out.md isn't in the directory",
      });
      expect(calls).toEqual([]);
    });

    it("stops a pass at its ninth round of reading, keeping what it read", async () => {
      const ended = Promise.withResolvers<void>();
      const { model, calls } = modelWith(() => rounds(9), {
        roundsPollMs: 1,
        wait: () => ended.promise,
      });
      const passing = model.intent(input);
      await vi.waitFor(() =>
        expect(calls.some((call) => call.path.endsWith("/interrupt"))).toBe(true),
      );
      ended.resolve();
      const result = await passing;
      expect(result.ok ? null : result.error).toMatchObject({
        kind: "reader",
        message: "It used up its rounds of reading before it answered.",
      });
      expect(result.ok ? [] : result.error.reads).toHaveLength(9);
    });

    it("lets a pass use all eight rounds", async () => {
      const ended = Promise.withResolvers<void>();
      const { model, calls } = modelWith(() => rounds(8), {
        roundsPollMs: 1,
        wait: () => ended.promise,
      });
      const passing = model.intent(input);
      await vi.waitFor(() =>
        expect(calls.filter((call) => call.path.endsWith("/message")).length).toBeGreaterThan(2),
      );
      expect(calls.some((call) => call.path.endsWith("/interrupt"))).toBe(false);
      ended.resolve();
      expect((await passing).ok).toBe(false);
    });

    it("takes reads that overflow the context for the reader's failure, and nothing else", async () => {
      const overflow = {
        type: "assistant",
        content: [],
        error: { type: "provider.context-overflow", message: "prompt is too long", status: 400 },
      };
      const failing = async (data: unknown[]) => {
        const result = await modelWith(() => ({ data })).model.intent(input);
        return result.ok ? null : result.error.kind;
      };
      expect(await failing([...rounds(1).data, overflow])).toBe("reader");
      expect(await failing([overflow])).toBe("too-large");
    });
  });

  it("estimates the input high and refuses a PR over the model's context", async () => {
    const measured = await modelWith().model.checkSize(smallFeatureInput);
    if (!measured.ok) throw new Error(measured.error.message);
    expect(measured.value.inputTokens).toBeGreaterThan(OVERHEAD_TOKENS);

    const small = await modelWith(undefined, { contextTokens: 34_000 }).model.checkSize(
      smallFeatureInput,
    );
    expect(small.ok ? null : small.error.kind).toBe("too-large");
  });
});
