import { describe, expect, it } from "vitest";
import { smallFeatureInput, smallFeatureIntent } from "../../../application/testing/index.ts";
import { MODEL_STAGES, ModelPass } from "../../../domain/review/index.ts";
import { fnv1a64 } from "../../../domain/shared/index.ts";
import { withHarness } from "../shared/fixtures/guidance.ts";
import { passSchema } from "../shared/prompted-answer.ts";
import { passMessage } from "../shared/prompts/passes.ts";
import { renderInput } from "../shared/render-input.ts";
import {
  entryBytes,
  opencodeConfig,
  opencodeRequest,
  prEntries,
  prEntry,
  variantFor,
} from "./opencode-request.ts";
import {
  OPENCODE_FINGERPRINT,
  OPENCODE_PROMPT_VERSION,
  OPENCODE_READER_FINGERPRINT,
  OPENCODE_TOUR_FINGERPRINT,
  opencodeVersion,
} from "./version.ts";

const haiku = { providerID: "anthropic", id: "claude-haiku-5-5" };

/** The review's four passes, or every pass, the steps pass among them. */
const requests = (passes: readonly ModelPass[] = MODEL_STAGES) =>
  passes.map((pass) =>
    opencodeRequest(
      pass,
      renderInput(smallFeatureInput),
      passMessage(pass, pass === "findings" ? smallFeatureIntent : null, ["problem"]),
      haiku,
      {
        variants: ["none", "low", "medium", "high", "xhigh", "max"],
      },
    ),
  );

describe("opencodeRequest", () => {
  it("puts the same PR entries in every pass, so later passes read them from cache", () => {
    const entries = new Set(requests().map((request) => JSON.stringify(request.entries)));
    expect(entries.size).toBe(1);
    expect(requests()[0]?.entries).toEqual([
      { key: "pull-request-00", value: expect.stringMatching(/^Everything after this line/) },
    ]);
  });

  it("ends each pass's prompt with the schema of its own answer only", () => {
    for (const [index, pass] of ModelPass.options.entries()) {
      const prompt = requests(ModelPass.options)[index]?.prompt ?? "";
      expect(prompt).toContain(`Task: ${pass}.`);
      expect(prompt).toMatch(/Answer with one JSON object and nothing else/);
      expect(prompt.endsWith(JSON.stringify(passSchema(pass)))).toBe(true);
    }
  });

  it("gives a session with a harness its directory and leave to read each file, after the agent's denials", () => {
    const files = new Set(["harness/CLAUDE.md", "harness/docs/a.md"]);
    const request = opencodeRequest("risk", "", "Task: risk.", haiku, {
      harness: { directory: "/tmp/run", files },
    });
    expect(request.session).toEqual({
      agent: "megareviewer",
      title: "megareviewer",
      model: { providerID: "anthropic", id: "claude-haiku-5-5" },
      location: { directory: "/tmp/run" },
      permissions: [
        { action: "read", resource: "harness/CLAUDE.md", effect: "allow" },
        { action: "read", resource: "harness/docs/a.md", effect: "allow" },
      ],
    });
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

describe("prEntries", () => {
  it("splits a PR over the entry limit between lines, in keys opencode joins in order", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index} ${"é".repeat(20)}`);
    const entries = prEntries(lines.join("\n"), 200);
    expect(entries.length).toBeGreaterThan(3);
    expect(entries.map((entry) => entry.key)).toEqual(entries.map((entry) => entry.key).sort());
    for (const entry of entries) expect(entryBytes(entry.value)).toBeLessThanOrEqual(200);
    expect(entries.map((entry) => entry.value).join("")).toBe(prEntry(lines.join("\n")));
    for (const entry of entries.slice(0, -1)) expect(entry.value.endsWith("\n")).toBe(true);
  });

  it("cuts a line longer than the limit where it has to", () => {
    const entries = prEntries("x".repeat(1000), 200);
    expect(entries.map((entry) => entry.value).join("")).toBe(prEntry("x".repeat(1000)));
    for (const entry of entries) expect(entryBytes(entry.value)).toBeLessThanOrEqual(200);
  });

  it("counts an entry as opencode does, its escapes included", () => {
    // On 2.3.0, 250,000 bytes of rendered PR were refused as 264,714.
    expect(entryBytes('a "b"\n')).toBe(Buffer.byteLength('a \\"b\\"\\n'));
    for (const entry of prEntries('"\n'.repeat(200), 200)) {
      expect(entryBytes(entry.value)).toBeLessThanOrEqual(200);
    }
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
  it("defines the passes' agent, the suggestion's and the guardrail call's, each denying every tool last", () => {
    const config = opencodeConfig();
    expect(config.agents).toEqual({
      megareviewer: expect.objectContaining({
        mode: "primary",
        system: expect.stringContaining("You help a human reviewer"),
        permissions: [{ action: "*", resource: "*", effect: "deny" }],
      }),
      "megareviewer-suggest": expect.objectContaining({
        mode: "primary",
        system: expect.stringContaining("You help a code reviewer write down"),
        permissions: [{ action: "*", resource: "*", effect: "deny" }],
      }),
      "megareviewer-guardrails": expect.objectContaining({
        mode: "primary",
        system: expect.stringContaining("could be caught by a check instead"),
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

  it("is bumped whenever the steps pass's request changes", () => {
    const current = fnv1a64(JSON.stringify(requests(["steps"])));
    expect(
      current,
      `The steps pass's request changed. Bump OPENCODE_PROMPT_VERSION in version.ts (now ` +
        `${OPENCODE_PROMPT_VERSION}) and set OPENCODE_TOUR_FINGERPRINT to "${current}".`,
    ).toBe(OPENCODE_TOUR_FINGERPRINT);
  });

  it("is bumped whenever a request with something to read changes", () => {
    const harness = { directory: "/tmp/run", files: new Set(["harness/CLAUDE.md"]) };
    const reading = MODEL_STAGES.map((pass) =>
      opencodeRequest(
        pass,
        renderInput(smallFeatureInput),
        passMessage(pass, null, undefined, withHarness(smallFeatureInput)),
        haiku,
        { harness },
      ),
    );
    const current = fnv1a64(JSON.stringify(reading));
    expect(
      current,
      `A request with something to read changed. Bump OPENCODE_PROMPT_VERSION in version.ts (now ` +
        `${OPENCODE_PROMPT_VERSION}) and set OPENCODE_READER_FINGERPRINT to "${current}".`,
    ).toBe(OPENCODE_READER_FINGERPRINT);
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
