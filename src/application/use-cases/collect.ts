import { type FileChange, parseUnifiedDiff } from "../../domain/diff/index.ts";
import { extractTicketKeys, type PullRequest, type Ticket } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { GitHost } from "../ports/index.ts";
import type { AppDeps } from "./deps.ts";
import { appError, type UseCaseError } from "./errors.ts";
import { mapLimit } from "./text.ts";

/**
 * Files per host call, and calls at a time. A host that batches reads (GitHub) makes one
 * request per call, so a PR's files take a few requests, each small enough to finish on a slow
 * link.
 */
const FILES_PER_BATCH = 10;
const BATCH_CONCURRENCY = 2;
/** Larger files are treated as unavailable: too big to parse or to send to the model. */
const MAX_FILE_BYTES = 1024 * 1024;

export interface Collected {
  readonly files: readonly FileChange[];
  /** The base version, so a PR can't hide code by editing it. */
  readonly gitattributes: string | null;
  /** By old path; null when the file doesn't exist at base, is too large, or wasn't fetched. */
  readonly baseContents: ReadonlyMap<string, string | null>;
  /** By path, like baseContents at head. */
  readonly headContents: ReadonlyMap<string, string | null>;
  readonly tickets: readonly Ticket[];
  readonly missingTicketKeys: readonly string[];
  readonly warnings: readonly string[];
}

export const collect = async (
  deps: AppDeps,
  host: GitHost,
  pullRequest: PullRequest,
): Promise<Result<Collected, UseCaseError>> => {
  const parsed = parseUnifiedDiff(pullRequest.diff);
  if (!parsed.ok) {
    const { line, message } = parsed.error;
    return err(
      appError("host-error", `Couldn't parse the pull request's diff: line ${line}: ${message}`),
    );
  }
  const files = parsed.value.map((file) => ({
    ...file,
    language: deps.parser.languageFor(file.path),
  }));

  const { repo } = pullRequest.ref;
  const fetches = [
    { side: "attributes" as const, sha: pullRequest.baseSha, path: ".gitattributes" },
    ...files
      .filter((file) => !file.binary)
      .flatMap((file) => [
        ...(file.status === "added"
          ? []
          : [{ side: "base" as const, sha: pullRequest.baseSha, path: file.oldPath ?? file.path }]),
        ...(file.status === "deleted"
          ? []
          : [{ side: "head" as const, sha: pullRequest.headSha, path: file.path }]),
      ]),
  ];
  const batches = Array.from({ length: Math.ceil(fetches.length / FILES_PER_BATCH) }, (_, i) =>
    fetches.slice(i * FILES_PER_BATCH, (i + 1) * FILES_PER_BATCH),
  );
  const results = await mapLimit(batches, BATCH_CONCURRENCY, async (batch) => ({
    batch,
    contents: await host.getFiles(repo, batch),
  }));

  let gitattributes: string | null = null;
  const baseContents = new Map<string, string | null>();
  const headContents = new Map<string, string | null>();
  for (const file of files) {
    if (file.status === "added") baseContents.set(file.path, null);
    if (file.status === "deleted") headContents.set(file.path, null);
  }
  for (const { batch, contents } of results) {
    if (!contents.ok) {
      return err(
        appError(
          "host-error",
          `Couldn't fetch the pull request's files: ${contents.error.message}`,
        ),
      );
    }
    for (const [i, { side, path }] of batch.entries()) {
      const content = fitsSize(contents.value[i] ?? null);
      if (side === "attributes") gitattributes = content;
      else (side === "base" ? baseContents : headContents).set(path, content);
    }
  }

  return ok({
    files,
    gitattributes,
    baseContents,
    headContents,
    ...(await collectTickets(deps, pullRequest)),
  });
};

const fitsSize = (content: string | null): string | null =>
  content !== null && new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES
    ? null
    : content;

/** Ticket problems never fail the analysis: the keys are still shown, just not fetched. */
const collectTickets = async (
  deps: AppDeps,
  pullRequest: PullRequest,
): Promise<Pick<Collected, "tickets" | "missingTicketKeys" | "warnings">> => {
  const keys = extractTicketKeys([
    pullRequest.title,
    pullRequest.description,
    pullRequest.sourceBranch,
    ...pullRequest.commits.map((commit) => commit.message),
  ]);
  if (keys.length === 0 || !deps.tickets.configured) {
    return { tickets: [], missingTicketKeys: keys, warnings: [] };
  }
  const lookup = await deps.tickets.getTickets(keys);
  if (!lookup.ok) {
    return {
      tickets: [],
      missingTicketKeys: keys,
      warnings: [`Couldn't fetch Jira tickets: ${lookup.error.message}`],
    };
  }
  return { tickets: lookup.value.found, missingTicketKeys: lookup.value.missing, warnings: [] };
};
