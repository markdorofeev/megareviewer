import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createGitCheckout } from "../src/adapters/git/index.ts";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import type { CodeParser, LocalCheckout } from "../src/application/ports/index.ts";
import { prep } from "../src/application/use-cases/prep.ts";
import {
  type CallGraphHint,
  type FileChange,
  type FileLink,
  type HunkPart,
  hunkIdOf,
  isTestFile,
  type MechanicalProof,
  type PartId,
  parseUnifiedDiff,
  type UnchangedCallers,
} from "../src/domain/diff/index.ts";
import {
  classifyByRules,
  codeTour,
  joinParts,
  PullRequest,
  type RiskAssessment,
  type Tour,
} from "../src/domain/review/index.ts";
import { type Call, chipCounts, chipPlan } from "../web/src/pages/review/chips.ts";
import { type FileOverview, fileOverview } from "../web/src/pages/review/overview.ts";

// Every stage of the flows slice measures itself on one real PR. This runs today's prep, rule
// risk and code tour on a PR whose diff and files are cached in ~/.megareviewer/db.sqlite, the way
// the pipeline does without the model, and prints what the stages track. It reads the database
// only, and never calls a host.

/** A cached file: its content, null when it isn't at that commit, undefined when not cached. */
export type CachedFile = (sha: string, path: string) => string | null | undefined;

export interface Measured {
  readonly files: readonly FileChange[];
  readonly risk: readonly RiskAssessment[];
  readonly callGraph: readonly CallGraphHint[];
  readonly fileLinks: readonly FileLink[];
  readonly generated: readonly string[];
  readonly proofs: readonly MechanicalProof[];
  /** Split hunks' parts, after the tour joined back the ones it reads together. */
  readonly parts: readonly HunkPart[];
  /** How many candidate parts prep cut, before joining back. */
  readonly candidates: number;
  readonly tour: Tour;
  /** Read from a local checkout at the head commit; none without one. */
  readonly unchangedCallers: readonly UnchangedCallers[];
  /** Files the PR changes that aren't in the cache, so they weren't parsed. */
  readonly missing: readonly string[];
}

export const measure = async (
  parser: CodeParser,
  pullRequest: PullRequest,
  cached: CachedFile,
  checkout: LocalCheckout | null = null,
): Promise<Measured> => {
  const parsed = parseUnifiedDiff(pullRequest.diff);
  if (!parsed.ok) throw new Error(`the cached diff doesn't parse: ${parsed.error.message}`);
  const files = parsed.value.map((file) => ({ ...file, language: parser.languageFor(file.path) }));
  const missing: string[] = [];
  const read = (sha: string, path: string): string | null => {
    const content = cached(sha, path);
    if (content === undefined) missing.push(path);
    return content ?? null;
  };
  const baseContents = new Map<string, string | null>();
  const headContents = new Map<string, string | null>();
  for (const file of files) {
    const base = file.oldPath ?? file.path;
    baseContents.set(base, file.status === "added" ? null : read(pullRequest.baseSha, base));
    headContents.set(
      file.path,
      file.status === "deleted" ? null : read(pullRequest.headSha, file.path),
    );
  }
  const prepared = await prep(
    parser,
    {
      files,
      gitattributes: cached(pullRequest.baseSha, ".gitattributes") ?? null,
      baseContents,
      headContents,
      tickets: [],
      missingTicketKeys: [],
      warnings: [],
    },
    checkout === null ? null : { checkout, sha: pullRequest.headSha },
  );
  const proofRisk = prepared.proofs.flatMap((proof): RiskAssessment[] =>
    proof.hunkId === null
      ? []
      : [{ hunkId: proof.hunkId, riskClass: "mechanical", reason: proof.detail, source: "proof" }],
  );
  const risk = [
    ...proofRisk,
    ...classifyByRules(files, new Set(proofRisk.map((one) => one.hunkId))),
  ];
  const joined = joinParts(
    codeTour({ files, risk, ...prepared }),
    prepared.parts,
    prepared.callGraph,
    prepared.unchangedCallers,
  );
  return {
    files,
    risk,
    callGraph: joined.callGraph,
    fileLinks: prepared.fileLinks,
    generated: [...prepared.generated].sort(),
    proofs: prepared.proofs,
    parts: joined.parts,
    candidates: prepared.parts.length,
    tour: joined.tour,
    unchangedCallers: joined.unchangedCallers,
    missing: [...new Set(missing)],
  };
};

/** The counts this slice tracks, from a measured PR. */
export const counts = (measured: Measured) => {
  const { files, callGraph, tour } = measured;
  const pathOf = new Map<PartId, string>(
    files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, file.path])),
  );
  const calls = callGraph.filter((hint) => hint.use === "call");
  const byLine = new Map<PartId, Map<number, Call[]>>();
  for (const { fromPartId, toPartId, symbol, line } of calls) {
    const lines = byLine.get(fromPartId) ?? new Map<number, Call[]>();
    lines.set(line, [...(lines.get(line) ?? []), { symbol, toPartId, line }]);
    byLine.set(fromPartId, lines);
  }
  const textOf = (id: PartId, line: number) =>
    files
      .flatMap((file) => file.hunks)
      .find((hunk) => hunk.id === hunkIdOf(id))
      ?.lines.find((one) => one.kind !== "del" && one.newLine === line)?.text;
  const plan = chipPlan(
    tour.steps.map((step) => step.partIds),
    byLine,
    textOf,
  );
  const callerFiles = new Map<PartId, Set<string>>();
  for (const { fromPartId, toPartId } of calls) {
    const path = pathOf.get(hunkIdOf(fromPartId));
    if (path !== undefined)
      callerFiles.set(toPartId, (callerFiles.get(toPartId) ?? new Set()).add(path));
  }
  const lines = [...byLine.values()].flatMap((onLines) => [...onLines.values()]);
  const split = new Set(measured.parts.map((part) => part.hunkId)).size;
  return {
    hunks: pathOf.size,
    splitHunks: split,
    parts: pathOf.size - split + measured.parts.length,
    candidateParts: measured.candidates,
    fileLinks: measured.fileLinks.length,
    callHints: calls.length,
    typeHints: callGraph.filter((hint) => hint.use === "type").length,
    unchangedCallerDefinitions: measured.unchangedCallers.length,
    unchangedUses: measured.unchangedCallers.reduce(
      (sum, callers) => sum + callers.uses.length + callers.more,
      0,
    ),
    unchangedCallerFiles: new Set(
      measured.unchangedCallers.flatMap((callers) => callers.uses.map((use) => use.path)),
    ).size,
    requestHints: callGraph.filter((hint) => hint.use === "request").length,
    linesWithSeveralCalls: lines.filter((onLine) => onLine.length > 1).length,
    ...chipCounts(plan),
    calledByLinks: calls.length,
    callerFiles: [...callerFiles.values()].reduce((sum, paths) => sum + paths.size, 0),
    mostCallerFiles: Math.max(0, ...[...callerFiles.values()].map((paths) => paths.size)),
    mostCallerTests: Math.max(
      0,
      ...[...callerFiles.values()].map((paths) => [...paths].filter(isTestFile).length),
    ),
  };
};

export const overviewOf = (measured: Measured): FileOverview =>
  fileOverview(measured, measured.tour.steps);

/** The overview's rows and strip, one line each, with entries, flags and badges. */
export const overviewLines = ({ rows, strip }: FileOverview): string[] => {
  const name = (node: FileOverview["rows"][number][number]) => {
    const notes = [
      ...(node.kind === "outside" ? ["outside"] : []),
      ...node.entries,
      ...(node.risk === "contract" ? ["contract"] : []),
      ...(node.generated ? ["generated"] : []),
    ];
    const badges = node.badges.length > 0 ? ` [${node.badges.map(basename).join(", ")}]` : "";
    return `${node.label}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}${badges}`;
  };
  return [
    ...rows.map((row, at) => `  ${at + 1}. ${row.map(name).join("; ")}`),
    `  Not linked: ${strip.map(name).join("; ")}`,
  ];
};

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export const report = (measured: Measured): string => {
  const riskOf = new Map(measured.risk.map((one) => [one.hunkId, one.riskClass]));
  const out: string[] = ["Files"];
  for (const file of measured.files) {
    const lines = file.hunks.flatMap((hunk) => hunk.lines);
    const added = lines.filter((line) => line.kind === "add").length;
    const deleted = lines.filter((line) => line.kind === "del").length;
    const risks = file.hunks.map((hunk) => (riskOf.get(hunk.id) ?? "logic")[0]).join("");
    out.push(`  ${file.path}  +${added} -${deleted}  hunks ${risks}`);
  }
  out.push("", "Tour");
  measured.tour.steps.forEach((step, at) => {
    const via = step.via.length > 0 ? `, ${step.via.length} via` : "";
    const hunks = step.partIds.length === 1 ? "1 part" : `${step.partIds.length} parts`;
    out.push(`  ${at + 1}. [${step.kind}] ${step.title}  (${hunks}${via})`);
  });
  const pathOfPart = (id: PartId) =>
    measured.files.find((file) => file.hunks.some((hunk) => hunk.id === hunkIdOf(id)))?.path ?? "";
  const requests = measured.callGraph.filter((hint) => hint.use === "request");
  if (requests.length > 0) {
    out.push("", "Requests");
    for (const hint of requests) {
      const to = `${basename(pathOfPart(hint.toPartId))} ${hint.toPartId}`;
      out.push(`  ${basename(pathOfPart(hint.fromPartId))}:${hint.line}  ${hint.symbol}  → ${to}`);
    }
  }
  if (measured.unchangedCallers.length > 0) {
    out.push("", "Used unchanged");
    for (const { partId, symbol, uses, more } of measured.unchangedCallers) {
      const calls = uses.filter((use) => use.use === "call").length;
      out.push(
        `  ${symbol} (${basename(pathOfPart(partId))} ${partId}): ${uses.length + more} uses, ${calls} calls`,
      );
      for (const use of uses) out.push(`    ${use.path}:${use.line}  ${use.use}`);
      if (more > 0) out.push(`    and ${more} more`);
    }
  }
  out.push("", "Overview", ...overviewLines(overviewOf(measured)));
  out.push("", "Counts");
  for (const [name, value] of Object.entries(counts(measured))) out.push(`  ${name}: ${value}`);
  if (measured.missing.length > 0) {
    out.push("", `Not cached, so not parsed: ${measured.missing.join(", ")}`);
  }
  return out.join("\n");
};

/** The PR of a cached analysis, and its cached files. */
export const fromDatabase = (
  db: DatabaseSync,
  analysisId: string,
): { readonly pullRequest: PullRequest; readonly cached: CachedFile } => {
  const row = db.prepare("SELECT payload FROM analyses WHERE id = ?").get(analysisId);
  if (row === undefined || typeof row.payload !== "string") {
    throw new Error(`no analysis ${analysisId} in the database`);
  }
  const pullRequest = PullRequest.parse(JSON.parse(row.payload).pullRequest);
  const { host, owner, repo } = pullRequest.ref.repo;
  const select = db.prepare(
    `SELECT content FROM file_contents
     WHERE host = ? AND owner = ? AND repo = ? AND sha = ? AND path = ?`,
  );
  const cached: CachedFile = (sha, path) => {
    const file = select.get(host, owner, repo, sha, path);
    if (file === undefined) return undefined;
    return typeof file.content === "string" ? file.content : null;
  };
  return { pullRequest, cached };
};

const listAnalyses = (db: DatabaseSync): string =>
  db
    .prepare(
      `SELECT id, host, owner, repo, number, pipeline_version FROM analyses
       ORDER BY updated_at DESC LIMIT 20`,
    )
    .all()
    .map(
      (row) =>
        `  ${row.id}  ${row.host} ${row.owner}/${row.repo}#${row.number}  (${row.pipeline_version})`,
    )
    .join("\n");

if (import.meta.main) {
  const { DatabaseSync } = await import("node:sqlite");
  const { homedir } = await import("node:os");
  const db = new DatabaseSync(join(homedir(), ".megareviewer", "db.sqlite"), { readOnly: true });
  const [analysisId, flag, dir] = process.argv.slice(2);
  if (analysisId === undefined || (flag !== undefined && (flag !== "--checkout" || !dir))) {
    console.log(
      `Usage: pnpm measure <analysis id> [--checkout <dir>]\n\nCached analyses:\n${listAnalyses(db)}`,
    );
    process.exit(1);
  }
  const { pullRequest, cached } = fromDatabase(db, analysisId);
  const parser = await createTreeSitterCodeParser({
    grammarsDir: join(import.meta.dirname, "../src/adapters/treesitter/grammars"),
  });
  const checkout = dir === undefined ? null : createGitCheckout({ dir });
  if (checkout !== null && !(await checkout.hasCommit(pullRequest.headSha))) {
    throw new Error(`${dir} doesn't have the PR's head commit ${pullRequest.headSha}`);
  }
  console.log(report(await measure(parser, pullRequest, cached, checkout)));
}
