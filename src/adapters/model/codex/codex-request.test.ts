import { describe, expect, it } from "vitest";
import { smallFeatureInput, smallFeatureIntent } from "../../../application/testing/index.ts";
import { ModelPass } from "../../../domain/review/index.ts";
import { fnv1a64 } from "../../../domain/shared/index.ts";
import { passMessage } from "../shared/prompts/passes.ts";
import { renderInput } from "../shared/render-input.ts";
import { codexRequest, DISABLED_FEATURES, INSTRUCTIONS_FILE } from "./codex-request.ts";
import { codexEffort } from "./models.ts";
import { CODEX_FINGERPRINT, CODEX_PROMPT_VERSION, codexVersion } from "./version.ts";

const requests = (model = "gpt-6-luna") =>
  ModelPass.options.map((pass) =>
    codexRequest(
      pass,
      renderInput(smallFeatureInput),
      passMessage(pass, pass === "findings" ? smallFeatureIntent : null, ["problem"]),
      model,
    ),
  );

const valueAfter = (args: readonly string[], flag: string) => args[args.indexOf(flag) + 1];

describe("codexRequest", () => {
  it("locks the session down: read-only sandbox, no user config, every tool feature off", () => {
    const args = requests()[0]?.args("/tmp/run") ?? [];
    expect(args.slice(0, 1)).toEqual(["exec"]);
    expect(valueAfter(args, "--model")).toBe("gpt-6-luna");
    expect(valueAfter(args, "--sandbox")).toBe("read-only");
    expect(valueAfter(args, "--cd")).toBe("/tmp/run/work");
    expect(valueAfter(args, "--output-schema")).toBe("/tmp/run/schema.json");
    expect(args).toContain("model_instructions_file=/tmp/run/instructions.md");
    for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "--json"]) {
      expect(args).toContain(flag);
    }
    expect(args).toContain("web_search=disabled");
    expect(args).toContain("project_doc_max_bytes=0");
    const disabled = args.flatMap((arg, index) => (args[index - 1] === "--disable" ? [arg] : []));
    expect(disabled).toEqual([...DISABLED_FEATURES]);
    expect(disabled).toContain("code_mode_host");
    expect(args.at(-1)).toBe("-");
  });

  it("sends each pass at its own effort, and the model asked for", () => {
    const efforts = requests("gpt-6-sol").map((request) => {
      const args = request.args("/tmp/run");
      return [valueAfter(args, "--model"), args.find((arg) => arg.startsWith("model_reasoning"))];
    });
    expect(efforts).toEqual([
      ["gpt-6-sol", "model_reasoning_effort=medium"],
      ["gpt-6-sol", "model_reasoning_effort=high"],
      ["gpt-6-sol", "model_reasoning_effort=low"],
      ["gpt-6-sol", "model_reasoning_effort=high"],
    ]);
  });

  it("keeps the cached part byte-identical across the four passes of one input", () => {
    const all = requests();
    expect(new Set(all.map((request) => JSON.stringify(request.files))).size).toBe(1);
    expect(all[0]?.files[INSTRUCTIONS_FILE]).toContain("<pull_request_data>");
    const withoutEffort = all.map((request) =>
      request.args("/tmp/run").filter((arg) => !arg.startsWith("model_reasoning_effort=")),
    );
    expect(new Set(withoutEffort.map((args) => JSON.stringify(args))).size).toBe(1);
    expect(all.map((request) => /^Task: (\w+)/m.exec(request.stdin)?.[1])).toEqual(
      ModelPass.options,
    );
  });
});

describe("codexEffort", () => {
  it("keeps an effort the model accepts, else takes the nearest, the lower on a tie", () => {
    expect(codexEffort(["low", "medium", "high"], "high")).toBe("high");
    expect(codexEffort(["low", "xhigh"], "medium")).toBe("low");
    expect(codexEffort(["xhigh", "max"], "high")).toBe("xhigh");
    expect(codexEffort([], "medium")).toBe("medium");
  });
});

describe("prompt version", () => {
  it("is bumped whenever the instructions, rendering, schema or arguments change", () => {
    const current = fnv1a64(
      JSON.stringify(requests().map((request) => ({ ...request, args: request.args("/tmp/run") }))),
    );
    expect(
      current,
      `The prompts or arguments changed. Bump CODEX_PROMPT_VERSION in version.ts (now ` +
        `${CODEX_PROMPT_VERSION}) and set CODEX_FINGERPRINT to "${current}".`,
    ).toBe(CODEX_FINGERPRINT);
  });

  it("names the model, and an effort for every pass", () => {
    expect(codexVersion("gpt-6-luna")).toBe(`codex/gpt-6-luna/p${CODEX_PROMPT_VERSION}`);
    expect(codexVersion("gpt-6-luna", "low")).toBe(`codex/gpt-6-luna@low/p${CODEX_PROMPT_VERSION}`);
  });
});
