// Records the opencode transport's fixtures from real runs of the installed `opencode`:
// node evals/record-opencode.ts [provider/model]
// The server's model, provider and default-model lists, then the five passes on small-feature, as
// the AnalysisModel contract suite sends them, on Haiku 5.5 through the reviewer's Anthropic
// provider unless another model is named. Messages keep everything but `native`, the providers'
// opaque signatures; the lists keep everything, which names no key.

import { mkdirSync, writeFileSync } from "node:fs";
import { runOpencodeCall } from "../src/adapters/model/opencode/opencode-analysis-model.ts";
import {
  createOpencodeClient,
  type OpencodeClient,
} from "../src/adapters/model/opencode/opencode-client.ts";
import { opencodeRequest } from "../src/adapters/model/opencode/opencode-request.ts";
import { createOpencodeServer } from "../src/adapters/model/opencode/opencode-server.ts";
import { opencodeStatus } from "../src/adapters/model/opencode/opencode-status.ts";
import { createRunOpencode } from "../src/adapters/model/opencode/run-opencode.ts";
import {
  type EarlierResults,
  passMessage,
  renderSkeleton,
} from "../src/adapters/model/shared/prompts/passes.ts";
import { renderInput } from "../src/adapters/model/shared/render-input.ts";
import {
  smallFeatureAnalysis,
  smallFeatureInput,
  smallFeatureIntent,
  smallFeatureSkeleton,
} from "../src/application/testing/index.ts";
import type { ModelPass } from "../src/domain/review/index.ts";

const OUT = new URL("../src/adapters/model/opencode/fixtures/", import.meta.url);
const [providerID, ...rest] = (process.argv[2] ?? "anthropic/claude-haiku-5-5").split("/");
const model = rest.join("/");
mkdirSync(OUT, { recursive: true });

const withoutNative = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutNative)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value).flatMap(([key, item]) =>
            key === "native" ? [] : [[key, withoutNative(item)]],
          ),
        )
      : value;

/** The real client, keeping the last answer to each GET by its path. */
const capturing = (client: OpencodeClient) => {
  const answers = new Map<string, unknown>();
  const wrapped: OpencodeClient = {
    async request(method, path, options) {
      const result = await client.request(method, path, options);
      if (method === "GET" && result.ok) answers.set(path.replace(/ses_\w+/, ":id"), result.value);
      return result;
    },
  };
  return { client: wrapped, answers };
};

const write = (name: string, value: unknown) =>
  writeFileSync(new URL(`${name}.json`, OUT), `${JSON.stringify(withoutNative(value), null, 1)}\n`);

const server = createOpencodeServer();
try {
  const { client, answers } = capturing(createOpencodeClient(server));
  const status = await opencodeStatus(createRunOpencode(), client);
  if (status.state !== "running") throw new Error(`opencode can't run: ${JSON.stringify(status)}`);
  write("models", answers.get("/api/model"));
  write("providers", answers.get("/api/provider"));
  write("default-model", answers.get("/api/model/default"));
  const offered = status.models.find((m) => m.providerID === providerID && m.id === model);
  if (offered === undefined) throw new Error(`${providerID}/${model} isn't offered`);

  // The contract suite's earlier results: the fixture analysis's own, not this model's.
  const risk = smallFeatureAnalysis.risk.flatMap(({ hunkId, riskClass, reason }) =>
    riskClass === "mechanical" ? [] : [{ hunkId, riskClass, reason, lines: null }],
  );
  const { decisions } = smallFeatureAnalysis;
  const skeleton = renderSkeleton({ tour: smallFeatureSkeleton, parts: [] }, smallFeatureInput);
  const passes: [ModelPass, EarlierResults | null][] = [
    ["intent", null],
    ["findings", { intent: smallFeatureIntent }],
    ["risk", { intent: smallFeatureIntent }],
    ["decisions", { intent: smallFeatureIntent }],
    ["tour", { intent: smallFeatureIntent, risk, decisions, skeleton }],
  ];
  for (const [pass, earlier] of passes) {
    const request = opencodeRequest(
      pass,
      renderInput(smallFeatureInput),
      passMessage(pass, earlier, undefined),
      { providerID: offered.providerID, id: offered.id },
      { variants: offered.variants },
    );
    const started = Date.now();
    const called = await runOpencodeCall(client, request);
    write(pass, answers.get("/api/session/:id/message"));
    console.log(
      `${pass}: ${called.ok ? "answered" : called.error.message}, ${Date.now() - started} ms`,
      called.ok ? JSON.stringify(called.value.tokens) : "",
    );
  }
} finally {
  server.stop();
}
