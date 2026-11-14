import { describe, expect, it } from "vitest";
import {
  smallFeatureAnalysis,
  smallFeatureInput,
  smallFeatureIntent,
} from "../../../application/testing/index.ts";
import { ModelPass } from "../../../domain/review/index.ts";
import { fnv1a64 } from "../../../domain/shared/index.ts";
import { PassAnswer } from "../shared/output-schema.ts";
import { passMessage } from "../shared/prompts/passes.ts";
import { renderInput } from "../shared/render-input.ts";
import { answerJson } from "./opencode-output.ts";
import { opencodeConfig, opencodeRequest, passSchema, variantFor } from "./opencode-request.ts";
import { OPENCODE_FINGERPRINT, OPENCODE_PROMPT_VERSION, opencodeVersion } from "./version.ts";

const risk = smallFeatureAnalysis.risk.flatMap(({ hunkId, riskClass, reason }) =>
  riskClass === "mechanical" ? [] : [{ hunkId, riskClass, reason, lines: null }],
);
const earlier = { intent: smallFeatureIntent, risk, decisions: smallFeatureAnalysis.decisions };
const haiku = { providerID: "anthropic", id: "claude-haiku-5-5" };

const requests = () =>
  ModelPass.options.map((pass) =>
    opencodeRequest(
      pass,
      renderInput(smallFeatureInput),
      passMessage(pass, earlier, ["problem"]),
      haiku,
      {
        variants: ["none", "low", "medium", "high", "xhigh", "max"],
      },
    ),
  );

describe("opencodeRequest", () => {
  it("puts the same PR entry in every pass, so later passes read it from cache", () => {
    const entries = new Set(requests().map((request) => request.entry));
    expect(entries.size).toBe(1);
    expect([...entries][0]).toMatch(/^Everything after this line is the pull request data\./);
  });

  it("ends each pass's prompt with the schema of its own answer only", () => {
    for (const [index, pass] of ModelPass.options.entries()) {
      const prompt = requests()[index]?.prompt ?? "";
      expect(prompt).toContain(`Task: ${pass}.`);
      expect(prompt).toMatch(/Answer with one JSON object and nothing else/);
      expect(prompt.endsWith(JSON.stringify(passSchema(pass)))).toBe(true);
    }
  });

  it("asks for an answer the shared schema accepts", () => {
    const schema = passSchema("findings");
    expect(schema).toMatchObject({ required: ["answer"], additionalProperties: false });
    expect(
      PassAnswer.safeParse(answerJson('{"answer":{"pass":"findings","findings":[]}}')).success,
    ).toBe(true);
  });

  it("leaves the variant out for a model without any", () => {
    const request = opencodeRequest("intent", "", "Task: intent.", haiku);
    expect(request.session).toEqual({
      agent: "megareviewer",
      title: "megareviewer",
      model: { providerID: "anthropic", id: "claude-haiku-5-5" },
    });
  });
});

describe("variantFor", () => {
  it("keeps an effort the model offers, else takes the nearest, the lower on a tie", () => {
    expect(variantFor(["low", "medium", "high"], "high")).toBe("high");
    expect(variantFor(["minimal", "high"], "medium")).toBe("high");
    expect(variantFor(["low", "xhigh"], "medium")).toBe("low");
    expect(variantFor(["thinking"], "medium")).toBeNull();
    expect(variantFor([], "low")).toBeNull();
  });
});

describe("opencodeConfig", () => {
  it("defines the agent with the shared instructions, denying every tool last", () => {
    const config = opencodeConfig();
    expect(config.agents).toEqual({
      megareviewer: expect.objectContaining({
        mode: "primary",
        system: expect.stringContaining("You help a human reviewer"),
        permissions: [{ action: "*", resource: "*", effect: "deny" }],
      }),
    });
  });
});

describe("prompt version", () => {
  it("is bumped whenever the instructions, rendering, schema, config or requests change", () => {
    const current = fnv1a64(JSON.stringify({ config: opencodeConfig(), requests: requests() }));
    expect(
      current,
      `The prompts or requests changed. Bump OPENCODE_PROMPT_VERSION in version.ts (now ` +
        `${OPENCODE_PROMPT_VERSION}) and set OPENCODE_FINGERPRINT to "${current}".`,
    ).toBe(OPENCODE_FINGERPRINT);
  });

  it("names the provider and model, and an effort for every pass", () => {
    expect(opencodeVersion("ollama", "qwen3:8b")).toBe(
      `opencode/ollama/qwen3:8b/p${OPENCODE_PROMPT_VERSION}`,
    );
    expect(opencodeVersion("ollama", "qwen3:8b", "low")).toBe(
      `opencode/ollama/qwen3:8b@low/p${OPENCODE_PROMPT_VERSION}`,
    );
  });
});
