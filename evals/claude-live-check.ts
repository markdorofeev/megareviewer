// Live check of the Claude adapter against the real API:
// node evals/claude-live-check.ts [--harness] [--record]
// Needs Anthropic credentials (ANTHROPIC_API_KEY or `ant auth login`) and spends money, so CI
// never runs it. Runs checkSize and the passes, the steps pass among them, on the small-feature and
// prompt-injection fixtures, intent first, prints each pass's answer, usage and cost, and fails
// unless the passes after it read the PR from the prompt cache. It's the only check that the API
// takes the requests: counting tokens accepts what a pass is then refused for, as it was the
// passes' output format. --harness runs small-feature alone, on Haiku 5.5, with a harness to read,
// and prints what each round of a pass read and what of it came from the cache. --record writes the
// responses, small-feature's to src/adapters/model/claude/fixtures/small-feature.json or with
// --harness to reading.json, in the format the adapter's tests replay.
// It lives here because only tests, the dev server and evals may use the test fixtures.

import { writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { createClaudeAnalysisModel } from "../src/adapters/model/index.ts";
import {
  type AnalysisInput,
  type AnalysisModel,
  type InputHarness,
  type Logger,
  NO_GUIDANCE,
  type PassOutput,
} from "../src/application/ports/index.ts";
import {
  type PullRequestFixture,
  promptInjection,
  smallFeatureInput,
} from "../src/application/testing/index.ts";
import { findMechanicalProofs, parseUnifiedDiff } from "../src/domain/diff/index.ts";
import { type HarnessRead, harnessCopy, harnessOutline } from "../src/domain/review/index.ts";
import { areaDocument } from "./documents.ts";

const print = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

interface Round {
  readonly pass: unknown;
  readonly round: unknown;
  readonly inputTokens: unknown;
  readonly cacheReadTokens: unknown;
  readonly cacheWriteTokens: unknown;
}

const rounds: Round[] = [];

const logger: Logger = {
  debug: (message, fields) => {
    if (message !== "Model round finished") return;
    const { pass, round, inputTokens, cacheReadTokens, cacheWriteTokens } = fields ?? {};
    rounds.push({ pass, round, inputTokens, cacheReadTokens, cacheWriteTokens });
  },
  info: () => {},
  warn: (message, fields) => print(`warn: ${message} ${JSON.stringify(fields ?? {})}`),
  error: (message, fields) => print(`error: ${message} ${JSON.stringify(fields ?? {})}`),
};

/** The analysis input the pipeline would build: hunks with a proof go as stats, the rest in full. */
const inputFrom = (fixture: PullRequestFixture): AnalysisInput => {
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
    unchangedCallers: [],
    guidance: NO_GUIDANCE,
    harness: null,
  };
  return input;
};

const FIRST = "harness/docs/where-rules-are.md";
const AREAS = ["Accounts", "Invoices", "Receipts", "Orders", "Search", "Exports"];
const ruleFile = (index: number) => `harness/docs/rules/${String(index + 1).padStart(2, "0")}.md`;

/**
 * A harness of two hops: which of the numbered files has the rules of some code is only said in the
 * first, so a pass that reads what it needs has a second round, which reads the first's file again.
 */
const harness = (): InputHarness => {
  const rules = AREAS.map((name, index) => ({
    path: ruleFile(index),
    content: areaDocument(
      `Rules ${index + 1}`,
      `How ${name.toLowerCase()} are kept.`,
      [{ name, owner: "platform" }],
      index,
    ),
  }));
  const first = [
    "# Where rules are",
    "",
    "Each part of the service has its rules in a file of its own, named by a number. Before a change is reviewed, read the file of the part it touches and no other.",
    "",
    "| Code | Part | Rules |",
    "|---|---|---|",
    ...AREAS.map((name, index) => {
      const part = name.toLowerCase();
      return `| \`src/**/${part}.ts\` and what it calls | ${part} | \`${ruleFile(index)}\` |`;
    }),
    "",
    areaDocument("Every part", "What every part shares.", [
      { name: "Shared rules", owner: "platform" },
    ]),
  ].join("\n");
  const files = [{ path: FIRST, content: first }, ...rules].map(({ path, content }, index) => {
    const copy = harnessCopy(content);
    return {
      path,
      content: copy.content,
      ref: `g${index + 1}`,
      bytes: Buffer.byteLength(content, "utf8"),
      lines: copy.lines,
      linkedFrom: index === 0 ? "CLAUDE.md" : FIRST.replace("harness/", ""),
      headings: index === 0 ? harnessOutline(copy.content).headings : [],
    };
  });
  return {
    files: files.map(({ content: _, ...file }) => file),
    contents: new Map(files.map(({ path, content }) => [path, content])),
  };
};

/** Responses of the passes, for --record, with a harness one a round. */
const recording: { countTokens?: unknown; passes: Record<string, { sse: string }[]> } = {
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
    if (pass !== undefined)
      recording.passes[pass] = [...(recording.passes[pass] ?? []), { sse: text }];
  }
  return response;
};

const failures: string[] = [];

const shownRead = ({ path, fromLine, toLine, outcome }: HarnessRead): string =>
  `${outcome === "refused" ? "refused " : ""}${path}${fromLine === null ? "" : `:${fromLine}-${toLine}`}`;

const report = (
  name: string,
  pass: string,
  { usage, value, reads = [] }: PassOutput<unknown>,
): void => {
  const own = rounds.filter((round) => round.pass === pass);
  print(`\n── ${name} · ${pass} ──`);
  print(JSON.stringify(value, null, 2));
  for (const { round, inputTokens, cacheReadTokens, cacheWriteTokens } of own) {
    print(
      `round ${round}: ${inputTokens} in, ${cacheReadTokens} cache read, ${cacheWriteTokens} cache write`,
    );
  }
  if (reads.length > 0) print(`read: ${reads.map(shownRead).join(", ")}`);
  print(
    `tokens: ${usage.inputTokens} in, ${usage.cacheReadTokens} cache read, ` +
      `${usage.cacheWriteTokens} cache write, ${usage.outputTokens} out · $${(usage.costUsd ?? 0).toFixed(4)}`,
  );
  if (pass !== "intent" && own[0]?.cacheReadTokens === 0) {
    failures.push(`${name} ${pass}: no cache read`);
  }
};

const check = async (model: AnalysisModel, name: string, input: AnalysisInput) => {
  rounds.length = 0;
  const size = await model.checkSize(input);
  if (!size.ok) throw new Error(`${name} checkSize: ${size.error.message}`);
  print(`\n${name}: ${size.value.inputTokens} input tokens`);

  const intent = await model.intent(input);
  if (!intent.ok) throw new Error(`${name} intent: ${intent.error.message}`);
  report(name, "intent", intent.value);

  const steps = await model.steps(input, { tour: true });
  if (!steps.ok) throw new Error(`${name} steps: ${steps.error.message}`);
  report(name, "steps", steps.value);

  const findings = await model.findings(input, intent.value.value);
  if (!findings.ok) throw new Error(`${name} findings: ${findings.error.message}`);
  report(name, "findings", findings.value);

  const total = [intent, steps, findings].reduce(
    (sum, result) => sum + (result.value.usage.costUsd ?? 0),
    0,
  );
  print(`\n${name}: $${total.toFixed(4)} in total`);
};

const FIXTURES = "../src/adapters/model/claude/fixtures";

const main = async (): Promise<void> => {
  const record = process.argv.includes("--record");
  const withHarness = process.argv.includes("--harness");
  const client = new Anthropic(record ? { fetch: recordingFetch } : {});
  const model = createClaudeAnalysisModel({
    client,
    logger,
    ...(withHarness ? { model: "claude-haiku-5-5" } : {}),
  });
  print(`model version ${model.version}`);

  await check(
    model,
    "small-feature",
    withHarness ? { ...smallFeatureInput, harness: harness() } : smallFeatureInput,
  );
  if (record) {
    const name = withHarness ? "reading.json" : "small-feature.json";
    const out = new URL(`${FIXTURES}/${name}`, import.meta.url);
    await writeFile(out, `${JSON.stringify(recording, null, 2)}\n`);
    print(`\nwrote ${out.pathname}`);
  }
  if (!withHarness) await check(model, "prompt-injection", inputFrom(promptInjection));

  if (failures.length > 0) throw new Error(failures.join("\n"));
  print(
    `\nCache reads confirmed for the passes after the intent.${withHarness ? "" : " Check the prompt-injection answers by eye."}`,
  );
};

await main();
