import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import type { CodeParser } from "../src/application/ports/index.ts";
import { FakeAnalysisModel } from "../src/application/testing/index.ts";
import { HunkId, hunkHasLine } from "../src/domain/diff/index.ts";
import {
  type Analysis,
  checkGuidanceMark,
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

it("has a case for each kind of guidance, each labeled with what its guidance should do", () => {
  const guided = evalCases.filter((c) => c.guidance !== undefined);
  const kinds = guided.flatMap(({ guidance }) => [
    ...(guidance?.preferences.map((preference) => preference.kind) ?? []),
    ...(guidance?.guidelines.map(() => "guideline") ?? []),
  ]);
  expect([...new Set(kinds)].sort()).toEqual(["dont-flag", "guideline", "look-for"]);
  for (const { name, labels } of guided) expect(labels.guidance ?? [], name).not.toEqual([]);
  const effects = guided.flatMap((c) => c.labels.guidance?.map((label) => label.effect) ?? []);
  expect([...new Set(effects)].sort()).toEqual(["left-out", "raised"]);
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
          guidance: evalCase.guidance,
        });
        if (!result.ok) throw new Error(result.error);
        analysis = result.value.analysis;
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

      it("give a run the case's guidance, numbered in the order the case lists it", () => {
        const given = evalCase.guidance ?? { preferences: [], guidelines: [] };
        expect(
          analysis.guidance?.preferences.map(({ ref, kind, text, scope }) => ({
            ref,
            kind,
            text,
            scope: scope.kind,
          })),
        ).toEqual(given.preferences.map((preference, i) => ({ ref: `p${i + 1}`, ...preference })));
        expect(analysis.guidance?.guidelines.map(({ ref, path }) => ({ ref, path }))).toEqual(
          given.guidelines.map(({ path }, i) => ({ ref: `g${i + 1}`, path })),
        );
      });

      it("expect of guidance marks the run would keep, on labeled points", () => {
        for (const label of labels.guidance ?? []) {
          const mark = { ref: label.ref, effect: label.effect };
          expect(checkGuidanceMark(mark, analysis.guidance), label.ref).toEqual(mark);
          expect(label.findings.length, label.ref).toBeGreaterThan(0);
          for (const index of [...label.findings, ...(label.alsoOn ?? [])]) {
            expect(labels.findings[index], `${label.ref} finding ${index}`).toBeDefined();
          }
          if (label.effect !== "left-out") continue;
          // What the reviewer asked not to be told can't also be what they must see.
          for (const index of label.findings) expect(labels.findings[index]?.mustHave).toBe(false);
        }
      });
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
