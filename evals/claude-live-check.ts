// Live check of the Claude adapter against the real API: node evals/claude-live-check.ts [--record]
// Needs Anthropic credentials (ANTHROPIC_API_KEY or `ant auth login`) and spends money, so CI
// never runs it. Runs checkSize and the four passes on the small-feature and prompt-injection
// fixtures, prints each pass's answer, usage and cost, and fails unless passes 2–4 read the PR
// from the prompt cache. --record writes the small-feature responses to
// src/adapters/claude/fixtures/small-feature.json, in the format the adapter's tests replay.
// It lives here because only tests, the dev server and evals may use the test fixtures.

import { writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { createClaudeAnalysisModel } from "../src/adapters/claude/index.ts";
import type {
  AnalysisInput,
  AnalysisModel,
  Logger,
  ModelRisk,
  TourSkeleton,
} from "../src/application/ports/index.ts";
import {
  type PullRequestFixture,
  promptInjection,
  smallFeatureInput,
  smallFeatureSkeleton,
} from "../src/application/testing/index.ts";
import { findMechanicalProofs, parseUnifiedDiff } from "../src/domain/diff/index.ts";
import { codeTour, DecisionId, type ModelUsage } from "../src/domain/review/index.ts";

const print = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const logger: Logger = {
  debug: () => {},
  info: () => {},
  warn: (message, fields) => print(`warn: ${message} ${JSON.stringify(fields ?? {})}`),
  error: (message, fields) => print(`error: ${message} ${JSON.stringify(fields ?? {})}`),
};

/**
 * The analysis input the pipeline would build: hunks with a proof go as stats, the rest in full. And
 * the code's tour of them.
 */
const inputFrom = (
  fixture: PullRequestFixture,
): { input: AnalysisInput; skeleton: TourSkeleton } => {
  const parsed = parseUnifiedDiff(fixture.pullRequest.diff);
  if (!parsed.ok) throw new Error(`${fixture.name}: ${parsed.error.message}`);
  const contents = (files: Readonly<Record<string, string>>) =>
    new Map(Object.entries(files).map(([path, content]) => [path, content]));
  const proofs = findMechanicalProofs(parsed.value, {
    gitattributes: null,
    baseContents: contents(fixture.baseFiles),
    headContents: contents(fixture.headFiles),
  });
  const proofOf = new Map(proofs.flatMap((proof) => (proof.hunkId ? [[proof.hunkId, proof]] : [])));
  const { pullRequest } = fixture;
  // The code's tour without call-graph hints or definitions: enough for the tour pass to title.
  const skeleton = codeTour({
    files: parsed.value,
    required: new Set(
      parsed.value.flatMap((file) =>
        file.hunks.flatMap((hunk) => (proofOf.has(hunk.id) ? [] : [hunk.id])),
      ),
    ),
    callGraph: [],
    risk: [],
    definitions: new Map(),
  });
  const input: AnalysisInput = {
    pullRequest: {
      title: pullRequest.title,
      description: pullRequest.description,
      sourceBranch: pullRequest.sourceBranch,
      targetBranch: pullRequest.targetBranch,
      commits: pullRequest.commits,
      url: pullRequest.url,
    },
    tickets: fixture.tickets,
    files: parsed.value.map((file) => {
      const hunks = file.hunks.filter((hunk) => !proofOf.has(hunk.id));
      return {
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
        language: file.language,
        mechanical: hunks.length === 0 && file.hunks.length > 0,
        hunks,
        mechanicalHunks: file.hunks.flatMap((hunk) => {
          const proof = proofOf.get(hunk.id);
          const count = (kind: string) => hunk.lines.filter((line) => line.kind === kind).length;
          return proof === undefined
            ? []
            : [{ hunkId: hunk.id, proof, additions: count("add"), deletions: count("del") }];
        }),
        headContent: fixture.headFiles[file.path] ?? null,
      };
    }),
    callGraph: [],
  };
  return { input, skeleton: { tour: skeleton, parts: [] } };
};

/** Requests and responses of the passes, for --record. */
const recording: { countTokens?: unknown; passes: Record<string, { sse: string }> } = {
  passes: {},
};

const recordingFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const body = await request.clone().text();
  const response = await fetch(request);
  const text = await response.clone().text();
  if (new URL(request.url).pathname.endsWith("/count_tokens")) {
    recording.countTokens = JSON.parse(text);
  } else {
    const pass = /Task: (\w+)\./.exec(body)?.[1];
    if (pass !== undefined) recording.passes[pass] = { sse: text };
  }
  return response;
};

const failures: string[] = [];

const report = (name: string, pass: string, usage: ModelUsage, value: unknown): void => {
  print(`\n── ${name} · ${pass} ──`);
  print(JSON.stringify(value, null, 2));
  print(
    `tokens: ${usage.inputTokens} in, ${usage.cacheReadTokens} cache read, ` +
      `${usage.cacheWriteTokens} cache write, ${usage.outputTokens} out · $${usage.costUsd.toFixed(4)}`,
  );
  if (pass !== "intent" && usage.cacheReadTokens === 0) {
    failures.push(`${name} ${pass}: no cache read`);
  }
};

const check = async (
  model: AnalysisModel,
  name: string,
  input: AnalysisInput,
  skeleton: TourSkeleton,
) => {
  const size = await model.checkSize(input);
  if (!size.ok) throw new Error(`${name} checkSize: ${size.error.message}`);
  print(`\n${name}: ${size.value.inputTokens} input tokens`);

  const intent = await model.intent(input);
  if (!intent.ok) throw new Error(`${name} intent: ${intent.error.message}`);
  report(name, "intent", intent.value.usage, intent.value.value);

  const [risk, decisions] = await Promise.all([
    model.risk(input, intent.value.value),
    model.decisions(input, intent.value.value),
  ]);
  if (!risk.ok) throw new Error(`${name} risk: ${risk.error.message}`);
  if (!decisions.ok) throw new Error(`${name} decisions: ${decisions.error.message}`);
  report(name, "risk", risk.value.usage, risk.value.value);
  report(name, "decisions", decisions.value.usage, decisions.value.value);

  const numbered = decisions.value.value.map((draft, index) => ({
    ...draft,
    id: DecisionId.parse(`d${index + 1}`),
  }));
  const riskValue: readonly ModelRisk[] = risk.value.value;
  const tour = await model.tour(input, intent.value.value, riskValue, numbered, skeleton);
  if (!tour.ok) throw new Error(`${name} tour: ${tour.error.message}`);
  report(name, "tour", tour.value.usage, tour.value.value);

  const total = [intent, risk, decisions, tour].reduce(
    (sum, result) => sum + result.value.usage.costUsd,
    0,
  );
  print(`\n${name}: $${total.toFixed(4)} in total`);
};

const main = async (): Promise<void> => {
  const record = process.argv.includes("--record");
  const client = new Anthropic(record ? { fetch: recordingFetch } : {});
  const model = createClaudeAnalysisModel({ client, logger });
  print(`model version ${model.version}`);

  await check(model, "small-feature", smallFeatureInput, {
    tour: smallFeatureSkeleton,
    parts: [],
  });
  if (record) {
    const out = new URL("../src/adapters/claude/fixtures/small-feature.json", import.meta.url);
    await writeFile(out, `${JSON.stringify(recording, null, 2)}\n`);
    print(`\nwrote ${out.pathname}`);
  }
  const injection = inputFrom(promptInjection);
  await check(model, "prompt-injection", injection.input, injection.skeleton);

  if (failures.length > 0) throw new Error(failures.join("\n"));
  print("\nCache reads confirmed for passes 2–4. Check the prompt-injection answers by eye.");
};

await main();
