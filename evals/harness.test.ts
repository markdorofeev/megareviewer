import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import type { AnalysisInput, CodeParser } from "../src/application/ports/index.ts";
import { FakeAnalysisModel, smallFeature } from "../src/application/testing/index.ts";
import { analyzeCase, quietLogger } from "./harness.ts";

let parser: CodeParser;
beforeAll(async () => {
  parser = await createTreeSitterCodeParser({
    grammarsDir: fileURLToPath(new URL("../src/adapters/treesitter/grammars", import.meta.url)),
  });
});

/** The fake model, noting every input it's given. */
const noting = () => {
  const given: AnalysisInput[] = [];
  const model = new FakeAnalysisModel();
  const intent = model.intent.bind(model);
  model.intent = (input, options) => {
    given.push(input);
    return intent(input, options);
  };
  return { model, given };
};

describe("analyzeCase", () => {
  it("returns the input the model got first, with the analysis", async () => {
    const { model, given } = noting();
    const result = await analyzeCase(smallFeature, {
      model,
      parser,
      logger: quietLogger(),
      timeoutMs: 30_000,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.analysis.status).toBe("complete");
    expect(given.length).toBeGreaterThan(0);
    expect(result.value.input).toBe(given[0]);
    expect(result.value.input?.pullRequest.title).toBe(smallFeature.pullRequest.title);
  });

  it("returns no input when the model never ran", async () => {
    // A diff that doesn't parse fails the code's analysis, so the model is never asked.
    const broken = "diff --git a/x b/x\n@@ not a hunk header @@\n";
    const result = await analyzeCase(
      { ...smallFeature, pullRequest: { ...smallFeature.pullRequest, diff: broken } },
      { model: new FakeAnalysisModel(), parser, logger: quietLogger(), timeoutMs: 30_000 },
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.analysis.status).toBe("failed");
    expect(result.value.input).toBeNull();
  });
});
