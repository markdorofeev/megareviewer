// Measures bytes per token of the Claude Code transport's prompt on every eval case, for
// BYTES_PER_TOKEN in src/adapters/claude/claude-code-analysis-model.ts:
// node evals/calibrate-claude-code.ts
// Each case is one short call on the signed-in Claude Code's plan, answering an empty risk task.

import { fileURLToPath } from "node:url";
import { z } from "zod";
import { claudeCodeRequest } from "../src/adapters/claude/claude-code-request.ts";
import { passMessage } from "../src/adapters/claude/prompts/passes.ts";
import { renderInput } from "../src/adapters/claude/render-input.ts";
import { createRunClaude } from "../src/adapters/claude/run-claude.ts";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import type { AnalysisInput, AnalysisModel } from "../src/application/ports/index.ts";
import { err } from "../src/domain/shared/index.ts";
import { evalCases } from "./cases/index.ts";
import { analyzeCase, quietLogger } from "./harness.ts";

const FirstUsage = z.object({
  type: z.literal("assistant"),
  message: z.object({
    usage: z.object({
      input_tokens: z.number(),
      cache_read_input_tokens: z.number(),
      cache_creation_input_tokens: z.number(),
    }),
  }),
});

const parser = await createTreeSitterCodeParser({
  grammarsDir: fileURLToPath(new URL("../src/adapters/treesitter/grammars", import.meta.url)),
});
const run = createRunClaude();

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
  const message = `${passMessage("intent", null, undefined)}\n\nFor this measurement only, answer the risk task with no assessments.`;
  const request = claudeCodeRequest("risk", renderInput(input), message);
  const bytes = Object.values(request.files).reduce(
    (total, file) => total + Buffer.byteLength(file, "utf8"),
    Buffer.byteLength(request.stdin, "utf8"),
  );
  const ran = await run(request.args, { stdin: request.stdin, files: request.files });
  const usage = ran.lines
    .map((line) => FirstUsage.safeParse(JSON.parse(line)))
    .find((parsed) => parsed.success)?.data?.message.usage;
  if (usage === undefined) {
    console.log(`${evalCase.name}: no usage (${ran.stderr || ran.lines.at(-1)})`);
    continue;
  }
  const tokens =
    usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
  ratios.push(bytes / tokens);
  console.log(`${evalCase.name}: ${bytes} bytes, ${tokens} tokens, ${(bytes / tokens).toFixed(2)}`);
}
console.log(
  `lowest ${Math.min(...ratios).toFixed(2)}, highest ${Math.max(...ratios).toFixed(2)} bytes a token`,
);
