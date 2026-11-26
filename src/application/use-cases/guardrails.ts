import type { Hunk, HunkId } from "../../domain/diff/index.ts";
import {
  BUILD_FILE_PATHS,
  type CheckConfig,
  checkConfigPathsFor,
  checkConfigsOf,
  type Finding,
  type Guardrail,
  guardrailOf,
  MAX_CHECK_CONFIG_BYTES,
  type ModelCall,
  type ModelError,
  type ModelUsage,
  type PointLines,
  type PullRequest,
  type ReadCheckConfig,
  type RepoRef,
} from "../../domain/review/index.ts";
import { err, type Result } from "../../domain/shared/index.ts";
import type { AdvicePoint, GuardrailAdvisor } from "../ports/index.ts";
import type { AppDeps } from "./deps.ts";
import { readRootFiles } from "./guidance.ts";

/** Longer than this, the call is left, and the review stays as the passes made it. */
export const GUARDRAIL_CALL_MS = 30_000;
/** The lines of a point's code the call reads; the rest are counted. */
export const MAX_POINT_LINES = 40;

const utf8 = new TextEncoder();

const kilobytes = (bytes: number): string => `${Math.ceil(bytes / 1024)} KB`;

interface ReadFiles {
  readonly configs: readonly CheckConfig[];
  readonly buildFiles: readonly { readonly path: string; readonly content: string }[];
  readonly read: readonly ReadCheckConfig[];
  readonly warnings: readonly string[];
}

/**
 * The check configs for the tools of these paths and the build files, at a commit: read for the
 * guardrail call, so a PR can't rewrite the rules it's checked by. One that can't be read or is too
 * large is a warning, and the call goes on without it.
 */
const readChecks = async (
  deps: Pick<AppDeps, "fileCache" | "hosts">,
  repo: RepoRef,
  sha: string,
  paths: readonly string[],
): Promise<ReadFiles> => {
  const read = await readRootFiles(deps, repo, sha, [
    ...checkConfigPathsFor(paths),
    ...BUILD_FILE_PATHS,
  ]);
  if (!read.ok) {
    return {
      configs: [],
      buildFiles: [],
      read: [],
      warnings: [
        `Couldn't read the repository's check configs and build files, so the guardrail call ran without them: ${read.error.message}`,
      ],
    };
  }
  const found = checkConfigsOf(read.value);
  const warnings = found.tooLarge.map(
    ({ path, bytes }) =>
      `${path} is ${kilobytes(bytes)}, over the ${kilobytes(MAX_CHECK_CONFIG_BYTES)} a check config can be, so the guardrail call ran without it`,
  );
  const buildFiles: { path: string; content: string }[] = [];
  for (const path of BUILD_FILE_PATHS) {
    const content = read.value.get(path) ?? null;
    if (content === null) continue;
    const bytes = utf8.encode(content).byteLength;
    if (bytes > MAX_CHECK_CONFIG_BYTES) {
      warnings.push(
        `${path} is ${kilobytes(bytes)}, over the ${kilobytes(MAX_CHECK_CONFIG_BYTES)} a build file can be, so the guardrail call ran without it`,
      );
    } else buildFiles.push({ path, content });
  }
  const sizeOf = (content: string) => utf8.encode(content).byteLength;
  return {
    configs: found.configs,
    buildFiles,
    read: [
      ...found.configs.map(({ tool, path, content }) => ({ tool, path, bytes: sizeOf(content) })),
      ...buildFiles.map(({ path, content }) => ({ tool: null, path, bytes: sizeOf(content) })),
    ],
    warnings,
  };
};

const MARKER = { add: "+", del: "-", context: " " } as const;

/**
 * The lines a finding rests on as its hunk shows them, each with its diff marker; at most
 * MAX_POINT_LINES, the rest counted.
 */
export const codeOf = (hunk: Hunk, lines: PointLines): string[] => {
  const shown = hunk.lines.filter((line) => {
    const number = lines.side === "new" ? line.newLine : line.oldLine;
    return number !== null && number >= lines.startLine && number <= lines.line;
  });
  const text = shown.map((line) => `${MARKER[line.kind]}${line.text}`);
  return text.length <= MAX_POINT_LINES
    ? text
    : [...text.slice(0, MAX_POINT_LINES), `… ${text.length - MAX_POINT_LINES} more lines`];
};

export interface GuardrailCall {
  /** The run's findings, each the call marked with its guardrail. */
  readonly findings: readonly Finding[];
  /** The check configs and build files the call read. */
  readonly checks: readonly ReadCheckConfig[];
  readonly warnings: readonly string[];
  readonly usage: readonly ModelUsage[];
  readonly modelCalls: readonly ModelCall[];
  readonly ok: boolean;
}

const TIMED_OUT: ModelError = {
  kind: "network",
  message: `The guardrail call took more than ${GUARDRAIL_CALL_MS / 1000} seconds, so the review stays as the passes made it`,
};

/**
 * The guardrail call of a model run, after its passes: asks which of the run's findings a check
 * could catch, and marks each with the check the server can stand behind. Its
 * failure, an answer outside the schema or a call over GUARDRAIL_CALL_MS leaves the points as they
 * were, with the call's record saying why. Never throws.
 */
export const runGuardrailCall = async (
  deps: Pick<AppDeps, "fileCache" | "hosts" | "clock" | "logger">,
  advisor: GuardrailAdvisor,
  pullRequest: PullRequest,
  changedPaths: readonly string[],
  hunks: ReadonlyMap<HunkId, Hunk>,
  findings: readonly Finding[],
): Promise<GuardrailCall> => {
  const { repo } = pullRequest.ref;
  const startedAt = deps.clock.now();
  const points = findings.flatMap((finding): AdvicePoint[] => {
    const hunk = hunks.get(finding.lines.hunkId);
    if (hunk === undefined) return [];
    const { id: ref, title, explanation } = finding;
    return [{ ref, path: hunk.path, title, explanation, code: codeOf(hunk, finding.lines) }];
  });
  const files = await readChecks(deps, repo, pullRequest.baseSha, [
    ...new Set(points.map((point) => point.path)),
  ]);

  const answered = await Promise.race([
    advisor
      .advise({ repo, points, configs: files.configs, buildFiles: files.buildFiles })
      .catch(
        (error: unknown): Result<never, ModelError> =>
          err({ kind: "unexpected", message: `The guardrail call crashed: ${String(error)}` }),
      ),
    deps.clock.wait(GUARDRAIL_CALL_MS).then((): Result<never, ModelError> => err(TIMED_OUT)),
  ]);
  const durationMs = Math.max(0, Date.parse(deps.clock.now()) - Date.parse(startedAt));
  const base = { checks: files.read, warnings: files.warnings };
  if (!answered.ok) {
    deps.logger.warn("Model call failed", {
      pass: "guardrails",
      attempt: 1,
      durationMs,
      kind: answered.error.kind,
      message: answered.error.message,
    });
    return {
      ...base,
      findings,
      usage: [],
      modelCalls: [
        {
          pass: "guardrails",
          attempt: 1,
          startedAt,
          durationMs,
          outcome: "failed",
          problems: [],
          error: answered.error,
          reads: [],
        },
      ],
      ok: false,
    };
  }

  const known = new Set(points.map((point) => point.ref));
  const marked = new Map<string, Guardrail>();
  const problems: string[] = [];
  for (const [index, mark] of answered.value.value.marks.entries()) {
    const point = mark.point.trim();
    const at = `Mark ${index + 1}, on ${point || "no point"}`;
    if (!known.has(point)) {
      problems.push(`${at}: left out, since the run has no such point`);
      continue;
    }
    if (marked.has(point)) {
      problems.push(`${at}: left out, since an earlier mark is on that point`);
      continue;
    }
    const guardrail = guardrailOf(mark.guardrail, files.configs, changedPaths);
    if (guardrail === null) {
      problems.push(
        `${at}: left out, since its rule is one the repository already has, or it names no valid check`,
      );
      continue;
    }
    marked.set(point, guardrail);
  }
  deps.logger.info("Model call answered", {
    pass: "guardrails",
    attempt: 1,
    durationMs,
    problems,
    marks: marked.size,
  });
  return {
    ...base,
    findings: findings.map((finding) => {
      const guardrail = marked.get(finding.id);
      return guardrail === undefined ? finding : { ...finding, guardrail };
    }),
    usage: [{ ...answered.value.usage, pass: "guardrails", startedAt, durationMs }],
    modelCalls: [
      {
        pass: "guardrails",
        attempt: 1,
        startedAt,
        durationMs,
        outcome: problems.length > 0 ? "problems" : "ok",
        problems,
        error: null,
        reads: [],
      },
    ],
    ok: true,
  };
};
