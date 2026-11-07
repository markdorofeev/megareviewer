import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { hunkIdOf } from "../../../domain/diff/index.ts";
import {
  Analysis,
  extractTicketKeys,
  Publication,
  PullRequest,
  Ticket,
  validateHunkReferences,
  validateRiskCoverage,
  validateTour,
} from "../../../domain/review/index.ts";
import {
  allFixtures,
  type PullRequestFixture,
  smallFeature,
  smallFeatureAnalysis,
  smallFeatureFiles,
  smallFeatureInput,
  smallFeaturePublication,
} from "./index.ts";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", ...args],
    {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    },
  );

const writeFiles = (root: string, files: Readonly<Record<string, string>>) => {
  for (const entry of readdirSync(root)) {
    if (entry !== ".git") rmSync(join(root, entry), { recursive: true });
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
};

/** The diff git produces from the fixture's base files to its head files. */
const gitDiff = (fixture: PullRequestFixture): string => {
  const root = mkdtempSync(join(tmpdir(), "megareviewer-fixture-"));
  try {
    git(root, "init", "--quiet");
    writeFiles(root, fixture.baseFiles);
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "--allow-empty", "--message", "base");
    writeFiles(root, fixture.headFiles);
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "--message", "head");
    return git(root, "-c", "core.abbrev=7", "diff", "--no-color", "--no-ext-diff", "-M", "HEAD~1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe.each(allFixtures.map((fixture) => [fixture.name, fixture] as const))(
  "fixture %s",
  (_, fixture) => {
    it("is a valid pull request with valid tickets", () => {
      expect(PullRequest.parse(fixture.pullRequest)).toEqual(fixture.pullRequest);
      for (const ticket of fixture.tickets) expect(Ticket.parse(ticket)).toEqual(ticket);
    });

    it("has the diff git produces from its base and head files", () => {
      expect(fixture.pullRequest.diff).toBe(gitDiff(fixture));
    });

    it("has a ticket for every key the PR mentions", () => {
      const { title, description, sourceBranch, commits } = fixture.pullRequest;
      const keys = extractTicketKeys([
        title,
        description,
        sourceBranch,
        ...commits.map((c) => c.message),
      ]);
      expect(fixture.tickets.map((ticket) => ticket.key)).toEqual(keys);
    });
  },
);

describe("small-feature analysis", () => {
  const hunkIds = new Set(smallFeatureFiles.flatMap((file) => file.hunks.map((hunk) => hunk.id)));

  it("has hunks that appear verbatim in the diff", () => {
    for (const file of smallFeatureFiles) {
      for (const hunk of file.hunks) {
        const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
        const kinds = { context: " ", add: "+", del: "-" };
        const body = hunk.lines.map((line) => kinds[line.kind] + line.text).join("\n");
        expect(smallFeature.pullRequest.diff).toContain(`${header}`);
        expect(smallFeature.pullRequest.diff).toContain(`\n${body}\n`);
      }
    }
    expect(hunkIds.size).toBe(6);
  });

  it("is a valid, complete analysis", () => {
    const { tour, risk, decisions, intent, callGraph } = smallFeatureAnalysis;

    expect(Analysis.parse(smallFeatureAnalysis)).toEqual(smallFeatureAnalysis);
    expect(tour && validateTour(tour, hunkIds)).toEqual([]);
    expect(validateRiskCoverage(risk, hunkIds)).toEqual([]);
    const referenced = [
      ...decisions.flatMap((decision) => decision.hunkIds),
      ...(intent?.mismatches.flatMap((mismatch) => mismatch.hunkIds) ?? []),
      ...callGraph.flatMap((hint) => [hunkIdOf(hint.fromPartId), hunkIdOf(hint.toPartId)]),
    ];
    expect(validateHunkReferences(hunkIds, referenced)).toEqual([]);
  });

  it("sends every hunk in full to the model, with head contents", () => {
    for (const file of smallFeatureInput.files) {
      expect(file.mechanical).toBe(false);
      expect(file.headContent).toBe(smallFeature.headFiles[file.path]);
    }
  });

  it("has a publication anchored on an added line", () => {
    expect(Publication.parse(smallFeaturePublication)).toEqual(smallFeaturePublication);
    for (const comment of smallFeaturePublication.comments) {
      const lines = smallFeatureFiles
        .filter((file) => file.path === comment.path)
        .flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines));
      expect(lines.some((line) => line.kind === "add" && line.newLine === comment.line)).toBe(true);
    }
  });
});
