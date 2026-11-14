import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import type { CodeParser } from "../src/application/ports/index.ts";
import { FakeAnalysisModel } from "../src/application/testing/index.ts";
import { HunkId, hunkHasLine } from "../src/domain/diff/index.ts";
import {
  type Analysis,
  extractTicketKeys,
  PullRequest,
  Ticket,
} from "../src/domain/review/index.ts";
import { evalCases } from "./cases/index.ts";
import { gitDiff } from "./git-diff.ts";
import { analyzeCase, quietLogger } from "./harness.ts";

let parser: CodeParser;
beforeAll(async () => {
  parser = await createTreeSitterCodeParser({
    grammarsDir: fileURLToPath(new URL("../src/adapters/treesitter/grammars", import.meta.url)),
  });
});

const casesDir = new URL("./cases/", import.meta.url);

it("registers every case directory once, under its own name", () => {
  const directories = readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect(evalCases.map((c) => c.name).sort()).toEqual(directories);
  for (const evalCase of evalCases) {
    expect(evalCase.fixture.name).toBe(evalCase.name);
  }
});

it("has the cases stage 16 asks for", () => {
  const count = (source: string) => evalCases.filter((c) => c.source === source).length;
  expect(count("fixture")).toBe(4);
  expect(evalCases.length).toBeGreaterThanOrEqual(13);
  expect(evalCases.filter((c) => c.labels.injection?.reported === true)).toHaveLength(1);
  const kinds = new Set(evalCases.flatMap((c) => c.labels.mismatches.map((m) => m.kind)));
  expect([...kinds].sort()).toEqual(["contradicts", "missing", "unrequested"]);
});

describe.each(evalCases.map((evalCase) => [evalCase.name, evalCase] as const))(
  "case %s",
  (_, evalCase) => {
    const { fixture, labels } = evalCase;

    it("is a valid pull request with valid tickets for every key it mentions", () => {
      expect(PullRequest.parse(fixture.pullRequest)).toEqual(fixture.pullRequest);
      for (const ticket of fixture.tickets) expect(Ticket.parse(ticket)).toEqual(ticket);
      if (evalCase.source !== "imported") {
        const { title, description, sourceBranch, commits } = fixture.pullRequest;
        const keys = extractTicketKeys([
          title,
          description,
          sourceBranch,
          ...commits.map((commit) => commit.message),
        ]);
        expect(fixture.tickets.map((ticket) => ticket.key)).toEqual(keys);
      }
    });

    it.runIf(evalCase.source === "synthetic")(
      "has the diff git makes from its files (node evals/make-diff.ts)",
      () => {
        expect(fixture.pullRequest.diff).toBe(gitDiff(fixture.baseFiles, fixture.headFiles));
      },
    );

    describe("labels", () => {
      let analysis: Analysis;
      beforeAll(async () => {
        const result = await analyzeCase(fixture, {
          model: new FakeAnalysisModel(),
          parser,
          logger: quietLogger(),
          timeoutMs: 30_000,
        });
        if (!result.ok) throw new Error(result.error);
        analysis = result.value.analysis;
      });

      it("refer to hunks the model classifies (none proved mechanical)", () => {
        expect(analysis.status).toBe("complete");
        const proved = new Set(analysis.proofs.map((proof) => proof.hunkId));
        const hunks = new Set(analysis.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)));
        for (const hunkId of Object.keys(labels.risk)) {
          expect(hunks, hunkId).toContain(hunkId);
          expect(proved, hunkId).not.toContain(hunkId);
        }
      });

      it("label every hunk the risk pass classifies", () => {
        const proved = new Set(analysis.proofs.map((proof) => proof.hunkId));
        const classified = analysis.files
          .flatMap((file) => file.hunks.map((hunk) => hunk.id))
          .filter((hunkId) => !proved.has(hunkId));
        expect(Object.keys(labels.risk).sort()).toEqual([...classified].sort());
      });

      it("say where each contract hunk's risk belongs, on lines it shows", () => {
        const hunks = new Map(
          analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)),
        );
        const contract = Object.entries(labels.risk).flatMap(([hunkId, label]) =>
          label === "contract" ? [hunkId] : [],
        );
        expect(Object.keys(labels.riskAt).sort()).toEqual(contract.sort());
        for (const [hunkId, places] of Object.entries(labels.riskAt)) {
          expect(places.length, hunkId).toBeGreaterThan(0);
          const hunk = hunks.get(HunkId.parse(hunkId));
          if (hunk === undefined) throw new Error(`${hunkId} isn't a hunk of the case`);
          for (const { hunkId: placeHunk, side, lines } of places) {
            expect(placeHunk).toBe(hunkId);
            expect(lines[0]).toBeLessThanOrEqual(lines[1]);
            for (const line of lines)
              expect(hunkHasLine(hunk, side, line), `${hunkId} ${line}`).toBe(true);
          }
        }
      });

      it("place each finding on lines a hunk the model reads shows", () => {
        const proved = new Set(analysis.proofs.map((proof) => proof.hunkId));
        const hunks = new Map(
          analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)),
        );
        for (const finding of labels.findings) {
          expect(finding.at.length, finding.description).toBeGreaterThan(0);
          for (const { hunkId, side, lines } of finding.at) {
            const hunk = hunks.get(HunkId.parse(hunkId));
            if (hunk === undefined) throw new Error(`${hunkId} isn't a hunk of the case`);
            expect(proved, hunkId).not.toContain(hunkId);
            expect(lines[0]).toBeLessThanOrEqual(lines[1]);
            for (const line of lines)
              expect(hunkHasLine(hunk, side, line), `${hunkId} ${line}`).toBe(true);
          }
        }
      });

      it("expect something of the model when it has hunks to look at", () => {
        const required =
          analysis.files.flatMap((file) => file.hunks).length - analysis.proofs.length;
        if (required > 0) {
          expect(Object.keys(labels.risk).length).toBeGreaterThan(0);
          expect([...labels.findings, ...labels.decisions].some((point) => point.mustHave)).toBe(
            true,
          );
        }
      });
    });

    it("phrase decisions as why, and leave what looks wrong to the findings", () => {
      for (const decision of labels.decisions) expect(decision.description).toMatch(/^Why /);
      for (const finding of labels.findings) expect(finding.description).not.toMatch(/^Why /);
    });

    it("tie each finding to a labeled mismatch at most once", () => {
      const shown = labels.findings.flatMap((finding) =>
        finding.mismatch === undefined ? [] : [finding.mismatch],
      );
      for (const index of shown) expect(labels.mismatches[index], String(index)).toBeDefined();
      expect(new Set(shown).size).toBe(shown.length);
    });
  },
);
