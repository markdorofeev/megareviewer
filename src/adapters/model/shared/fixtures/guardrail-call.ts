// Test support: what the guardrail call reads of a run, and an answer for it.

import type { AdviceDraft, AdviceInput } from "../../../../application/ports/index.ts";
import type { RepoRef } from "../../../../domain/review/index.ts";

const api: RepoRef = { host: "github", owner: "acme", repo: "api" };

/** A dropped promise and an off-by-one on a repository with a Biome config. */
export const guardrailInput: AdviceInput = {
  repo: api,
  points: [
    {
      ref: "f1",
      path: "src/orders/notify.ts",
      title: "Drops the promise `notify` returns",
      explanation: "A failed notification is never reported.",
      code: ["+  notify(order);", "+  return res.status(201).end();"],
    },
    {
      ref: "f2",
      path: "src/orders/page.ts",
      title: "Skips the last order of each page",
      explanation: "The slice ends one before the page's end.",
      code: ["+  return orders.slice(start, end - 1);"],
    },
  ],
  configs: [
    {
      tool: "biome",
      path: "biome.json",
      content: '{ "linter": { "rules": { "recommended": true } } }\n',
    },
  ],
  buildFiles: [
    { path: "package.json", content: '{ "devDependencies": { "@biomejs/biome": "2" } }\n' },
  ],
};

export const guardrailAnswer: AdviceDraft = {
  marks: [
    {
      point: "f1",
      guardrail: {
        kind: "lint-rule",
        tool: "biome",
        engine: "Biome",
        rule: "noFloatingPromises",
        on: false,
        does: "Reports a promise that is neither awaited, returned nor handled.",
      },
    },
  ],
};
