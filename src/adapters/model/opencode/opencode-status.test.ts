import { describe, expect, it } from "vitest";
import { z } from "zod";
import { err, ok } from "../../../domain/shared/index.ts";
import type { CommandRun, RunCommand } from "../shared/run-command.ts";
import { createFakeOpencodeClient, recorded } from "./fixtures/fake-opencode-client.ts";
import type { OpencodeClient } from "./opencode-client.ts";
import { opencodeStatus, parseModels } from "./opencode-status.ts";

const versionRun =
  (run: Partial<CommandRun>): RunCommand =>
  async () => ({ code: 0, started: true, lines: [], stderr: "", killed: null, ...run });

const dataOf = (list: unknown): unknown[] => z.object({ data: z.array(z.unknown()) }).parse(list).data;

const installed = versionRun({ lines: ["opencode v2.3.0"] });

/** The recorded lists, with `change` applied to the models and providers. */
const listing = (
  change: (lists: { models: unknown[]; providers: unknown[] }) => {
    models: unknown[];
    providers: unknown[];
  },
): OpencodeClient => {
  const models = dataOf(recorded("models"));
  const providers = dataOf(recorded("providers"));
  const changed = change({ models, providers });
  return {
    async request(_method, path) {
      if (path === "/api/model") return ok({ data: changed.models });
      if (path === "/api/provider") return ok({ data: changed.providers });
      return ok(recorded("default-model"));
    },
  };
};

describe("opencodeStatus", () => {
  it("is not installed when `opencode` can't be started, without starting a server", async () => {
    const { client, calls } = createFakeOpencodeClient();
    expect(await opencodeStatus(versionRun({ started: false, code: null }), client)).toEqual({
      state: "not-installed",
    });
    expect(calls).toEqual([]);
  });

  it("doesn't start the server of a version whose API megareviewer doesn't speak", async () => {
    const { client, calls } = createFakeOpencodeClient();
    expect(await opencodeStatus(versionRun({ lines: ["opencode v1.19.5"] }), client)).toEqual({
      state: "outdated",
      version: "1.19.5",
    });
    expect(calls).toEqual([]);
  });

  it("lists the recorded provider's chat models, with their efforts, contexts and prices", async () => {
    const status = await opencodeStatus(installed, createFakeOpencodeClient().client);
    if (status.state !== "running") throw new Error(status.state);
    expect(status.version).toBe("2.3.0");
    expect(status.defaultModel).toBe("anthropic/claude-fable-5-2");
    expect(status.models.find((model) => model.id === "claude-haiku-5-5")).toEqual({
      providerID: "anthropic",
      providerName: "Anthropic",
      id: "claude-haiku-5-5",
      name: "Claude Haiku 5.5",
      variants: ["none", "low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_000_000,
      priced: true,
    });
  });

  it("lists two providers' models, a local one without a price", async () => {
    const client = listing(({ models, providers }) => ({
      models: [
        ...models.slice(0, 1),
        { id: "qwen3:8b", providerID: "ollama", name: "Qwen3 8B", type: "chat", cost: [] },
        { id: "embed", providerID: "ollama", name: "Embed", type: "embedding" },
      ],
      providers: [...providers, { id: "ollama", name: "Ollama" }],
    }));
    const status = await opencodeStatus(installed, client);
    if (status.state !== "running") throw new Error(status.state);
    expect(status.models.map(({ providerName, id, priced }) => [providerName, id, priced])).toEqual([
      ["Anthropic", "claude-fable-5-2", true],
      ["Ollama", "qwen3:8b", false],
    ]);
  });

  it("runs with no models when nothing is connected", async () => {
    const client: OpencodeClient = {
      async request(_method, path) {
        return ok(path === "/api/model/default" ? { data: null } : { data: [] });
      },
    };
    expect(await opencodeStatus(installed, client)).toEqual({
      state: "running",
      version: "2.3.0",
      models: [],
      defaultModel: null,
    });
  });

  it("fails with why when the server can't be reached or lists something else", async () => {
    const down: OpencodeClient = {
      async request() {
        return err({ kind: "server", problem: { kind: "failed", message: "`opencode serve` exited (1): boom" } });
      },
    };
    expect(await opencodeStatus(installed, down)).toEqual({
      state: "failed",
      message: "`opencode serve` exited (1): boom",
    });
    expect(parseModels({ models: [] }, null)).toBeNull();
  });
});
