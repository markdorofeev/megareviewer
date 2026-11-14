// Measures bytes per token of the Codex transport's prompt on every eval case, for
// BYTES_PER_TOKEN and OVERHEAD_TOKENS in src/adapters/model/codex/codex-analysis-model.ts:
// node evals/calibrate-codex.ts
// Each case is one short call on the signed-in Codex's plan, answering an empty risk task. Bytes per
// token are counted after OVERHEAD_TOKENS, Codex's own: a call with a few hundred bytes of ours was
// about 5,300 tokens. One with an empty PR isn't a baseline: the model took several turns on it.

import { fileURLToPath } from "node:url";
import { OVERHEAD_TOKENS, runCodexCall } from "../src/adapters/model/codex/codex-analysis-model.ts";
import { codexRequest } from "../src/adapters/model/codex/codex-request.ts";
import { createRunCodex } from "../src/adapters/model/codex/run-codex.ts";
import { passMessage } from "../src/adapters/model/shared/prompts/passes.ts";
import { renderInput } from "../src/adapters/model/shared/render-input.ts";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import type { AnalysisInput, AnalysisModel } from "../src/application/ports/index.ts";
import { err } from "../src/domain/shared/index.ts";
import { evalCases } from "./cases/index.ts";
import { analyzeCase, quietLogger } from "./harness.ts";

const MODEL = "gpt-6-luna";
const parser = await createTreeSitterCodeParser({
  grammarsDir: fileURLToPath(new URL("../src/adapters/treesitter/grammars", import.meta.url)),
});
const run = createRunCodex();
const message = `${passMessage("intent", null, undefined)}\n\nFor this measurement only, answer the risk task with no assessments.`;

/** A call's prompt bytes and the input tokens Codex reported for it. */
const measure = async (rendered: string): Promise<{ bytes: number; tokens: number } | string> => {
  const request = codexRequest("risk", rendered, message, MODEL);
  const bytes = Object.values(request.files).reduce(
    (total, file) => total + Buffer.byteLength(file, "utf8"),
    Buffer.byteLength(request.stdin, "utf8"),
  );
  const called = await runCodexCall(run, request);
  if (!called.ok) return called.error.message;
  const { usage } = called.value;
  return { bytes, tokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens };
};

/** Stops the pipeline at the size check, keeping what the passes would read. */
const capturingModel = (onInput: (input: AnalysisInput) => void): AnalysisModel => {
  const fail = async () => err({ kind: "unexpected" as const, message: "not run" });
  return {
    version: "calibration",
    async checkSize(input) {
      onInput(input);
      return err({ kind: "too-large" as const, message: "captured" });
    },
    intent: fail,
    findings: fail,
    risk: fail,
    decisions: fail,
    tour: fail,
  };
};

const ratios: number[] = [];
for (const evalCase of evalCases) {
  let input: AnalysisInput | null = null;
  await analyzeCase(evalCase.fixture, {
    model: capturingModel((captured) => {
      input = captured;
    }),
    parser,
    logger: quietLogger(),
    timeoutMs: 60_000,
  });
  if (input === null) {
    console.log(`${evalCase.name}: no input captured`);
    continue;
  }
  const measured = await measure(renderInput(input));
  if (typeof measured === "string") {
    console.log(`${evalCase.name}: ${measured}`);
    continue;
  }
  const ratio = measured.bytes / (measured.tokens - OVERHEAD_TOKENS);
  ratios.push(ratio);
  console.log(
    `${evalCase.name}: ${measured.bytes} bytes, ${measured.tokens} tokens, ${ratio.toFixed(2)}`,
  );
}
console.log(
  `After ${OVERHEAD_TOKENS} tokens of Codex's own: lowest ${Math.min(...ratios).toFixed(2)}, highest ${Math.max(...ratios).toFixed(2)} bytes a token`,
);
