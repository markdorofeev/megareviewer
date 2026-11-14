import { describe, expect, it } from "vitest";
import type { ClaudeCodeStatus } from "../src/adapters/model/index.ts";
import { parseVia, preflight } from "./preflight.ts";

const signedIn: ClaudeCodeStatus = {
  state: "signed-in",
  version: "2.1.303",
  plan: "max",
  billing: "plan",
};

const checks = (status: ClaudeCodeStatus, credentials: boolean) => {
  const asked: string[] = [];
  return {
    asked,
    check: {
      claudeCode: async () => {
        asked.push("claude-code");
        return status;
      },
      hasApiCredentials: async () => {
        asked.push("api");
        return credentials;
      },
    },
  };
};

describe("preflight", () => {
  it("stops before anything runs when Claude Code isn't signed in, whichever runs the passes", async () => {
    for (const via of ["api", "claude-code"] as const) {
      const { check, asked } = checks({ state: "signed-out", version: "2.1.303" }, true);
      const ready = await preflight(via, check);
      if (ready.ok) throw new Error("expected preflight to fail");
      expect(ready.error).toMatch(/judge runs on Claude Code.*signed-out/);
      expect(asked).toEqual(["claude-code"]);
    }
  });

  it("asks for no API credentials with --via claude-code", async () => {
    const { check, asked } = checks(signedIn, false);
    const ready = await preflight("claude-code", check);
    expect(ready).toEqual({ ok: true, value: { billing: "plan", codex: null } });
    expect(asked).toEqual(["claude-code"]);
  });

  it("needs a signed-in Codex for the passes on Codex, and gives its models", async () => {
    const { check } = checks(signedIn, false);
    const out = await preflight("codex", {
      ...check,
      codex: async () => ({ state: "signed-out", version: "0.162.0" }),
    });
    if (out.ok) throw new Error("expected preflight to fail");
    expect(out.error).toMatch(/Codex, which needs to be signed in; it's signed-out/);

    const models = [{ slug: "gpt-6-sol", contextWindow: 272_000, efforts: ["low"] }];
    const ready = await preflight("codex", {
      ...check,
      codex: async () => ({ state: "signed-in", version: "0.162.0", billing: "plan", models }),
    });
    expect(ready).toEqual({
      ok: true,
      value: { billing: "plan", codex: { billing: "plan", models } },
    });
  });

  it("needs API credentials for the passes on the API", async () => {
    const { check } = checks(signedIn, false);
    const ready = await preflight("api", check);
    if (ready.ok) throw new Error("expected preflight to fail");
    expect(ready.error).toMatch(/No Anthropic credentials/);
    expect(await preflight("api", checks(signedIn, true).check)).toMatchObject({ ok: true });
  });

  it("takes only api or claude-code", () => {
    expect(parseVia("claude-code")).toBe("claude-code");
    expect(parseVia("plan")).toBeNull();
  });
});
