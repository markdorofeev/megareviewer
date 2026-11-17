import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import type { AnalysisInput, CodeParser } from "../src/application/ports/index.ts";
import { FakeAnalysisModel, smallFeature } from "../src/application/testing/index.ts";
import { ok } from "../src/domain/shared/index.ts";
import type { CaseGuidance } from "./guidance.ts";
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

  const guidance: CaseGuidance = {
    preferences: [
      { kind: "look-for", text: "Unbounded caches", scope: "global" },
      { kind: "dont-flag", text: "Naming of test helpers", scope: "repo" },
    ],
    guidelines: [{ path: "REVIEW.md", content: "Receipts are plain text.\n" }],
  };

  it("gives a run the case's guidance, numbered in the case's order", async () => {
    const result = await analyzeCase(smallFeature, {
      model: new FakeAnalysisModel(),
      parser,
      logger: quietLogger(),
      timeoutMs: 30_000,
      guidance,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.input?.guidance).toEqual({
      preferences: [
        { ref: "p1", kind: "look-for", text: "Unbounded caches", scope: "global" },
        { ref: "p2", kind: "dont-flag", text: "Naming of test helpers", scope: "repo" },
      ],
      guidelines: [{ ref: "g1", path: "REVIEW.md", content: "Receipts are plain text.\n" }],
    });
    expect(result.value.analysis.guidance?.preferences.map((p) => [p.ref, p.scope.kind])).toEqual([
      ["p1", "global"],
      ["p2", "repo"],
    ]);
    expect(result.value.analysis.warnings).toEqual([]);
  });

  it("keeps a mark that names the case's guidance, as a real run would", async () => {
    const run = (model: FakeAnalysisModel) =>
      analyzeCase(smallFeature, {
        model,
        parser,
        logger: quietLogger(),
        timeoutMs: 30_000,
        guidance,
      });
    const unmarked = await run(new FakeAnalysisModel());
    if (!unmarked.ok) throw new Error(unmarked.error);
    const model = new FakeAnalysisModel();
    model.script(
      "findings",
      ok(
        unmarked.value.analysis.findings.map(({ id: _, ...finding }) => ({
          ...finding,
          guidance: { ref: "p1", effect: "raised" as const },
        })),
      ),
    );
    const marked = await run(model);
    if (!marked.ok) throw new Error(marked.error);
    expect(marked.value.analysis.findings.map((finding) => finding.guidance)).toEqual([
      { ref: "p1", effect: "raised" },
    ]);
  });

  it("gives a run no guidance without any", async () => {
    const result = await analyzeCase(smallFeature, {
      model: new FakeAnalysisModel(),
      parser,
      logger: quietLogger(),
      timeoutMs: 30_000,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.input?.guidance).toEqual({ preferences: [], guidelines: [] });
  });
});
