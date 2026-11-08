import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, migrate } from "../src/adapters/sqlite/migrations.ts";
import {
  FakeCodeParser,
  FakeLocalCheckout,
  smallFeature,
} from "../src/application/testing/index.ts";
import { counts, fromDatabase, measure, report } from "./measure-pr.ts";

const { pullRequest, baseFiles, headFiles } = smallFeature;

/** A database holding one analysis of small-feature and its files, as the server caches them. */
const cachedDatabase = (cachedPaths: readonly string[]) => {
  const db = new DatabaseSync(":memory:");
  migrate(db, MIGRATIONS);
  const { host, owner, repo } = pullRequest.ref.repo;
  db.prepare(
    `INSERT INTO analyses
       (id, host, owner, repo, number, head_sha, pipeline_version, status, payload, created_at, updated_at)
     VALUES ('a_1', ?, ?, ?, ?, ?, '3+no-model', 'complete', ?, '', '')`,
  ).run(
    host,
    owner,
    repo,
    pullRequest.ref.number,
    pullRequest.headSha,
    JSON.stringify({ pullRequest }),
  );
  const insert = db.prepare(
    `INSERT INTO file_contents (host, owner, repo, sha, path, content, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, '')`,
  );
  for (const [sha, files] of [
    [pullRequest.baseSha, baseFiles],
    [pullRequest.headSha, headFiles],
  ] as const) {
    for (const [path, content] of Object.entries(files)) {
      if (cachedPaths.includes(path)) insert.run(host, owner, repo, sha, path, content);
    }
  }
  return db;
};

describe("measure-pr", () => {
  it("rebuilds the tour of a cached PR and counts its calls and chips", async () => {
    const paths = [...new Set([...Object.keys(baseFiles), ...Object.keys(headFiles)])];
    const { pullRequest: read, cached } = fromDatabase(cachedDatabase(paths), "a_1");
    expect(read).toEqual(pullRequest);
    const measured = await measure(new FakeCodeParser(), read, cached);
    expect(measured.missing).toEqual([]);
    expect(measured.tour.builtBy).toBe("code");
    const found = counts(measured);
    expect(found.hunks).toBe(measured.files.flatMap((file) => file.hunks).length);
    expect(found.callHints).toBe(measured.callGraph.filter((hint) => hint.use === "call").length);
    expect(found.chips + found.mentions).toBeLessThanOrEqual(found.callHints);
    expect(found.chips).toBeGreaterThan(0);
    const printed = report(measured);
    expect(printed).toContain("Tour\n  1. [flow] ");
    expect(printed).toContain(`  chips: ${found.chips}`);
    // The overview's rows: the route's file above the service it imports and calls.
    expect(found.fileLinks).toBe(1);
    expect(printed).toContain(
      "Overview\n  1. orders.ts (GET /orders/:id/receipt)\n  2. receipts.ts\n  Not linked: app.yaml (contract)\n",
    );
  });

  it("lists the callers outside the PR it reads from a checkout", async () => {
    const paths = [...new Set([...Object.keys(baseFiles), ...Object.keys(headFiles)])];
    const { cached } = fromDatabase(cachedDatabase(paths), "a_1");
    const checkout = new FakeLocalCheckout({
      [pullRequest.headSha]: {
        ...headFiles,
        "src/app.ts": 'import { ordersRouter } from "./routes/orders.ts";\napp.use(ordersRouter);',
      },
    });
    const measured = await measure(new FakeCodeParser(), pullRequest, cached, checkout);
    expect(counts(measured).unchangedUses).toBe(1);
    expect(report(measured)).toContain("Used unchanged\n  ordersRouter (orders.ts h_");
    expect(report(measured)).toContain("1 uses, 1 calls\n    src/app.ts:2  call\n");
  });

  it("lists the files it couldn't read from the cache", async () => {
    const [first] = Object.keys(headFiles);
    const { cached } = fromDatabase(cachedDatabase(first === undefined ? [] : [first]), "a_1");
    const measured = await measure(new FakeCodeParser(), pullRequest, cached);
    expect(measured.missing.length).toBeGreaterThan(0);
    expect(measured.missing).not.toContain(first);
    expect(report(measured)).toContain("Not cached, so not parsed: ");
  });

  it("says when the analysis isn't in the database", () => {
    expect(() => fromDatabase(cachedDatabase([]), "a_2")).toThrow("no analysis a_2");
  });
});
