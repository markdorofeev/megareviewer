import { type FileChange, parseUnifiedDiff } from "../../domain/diff/index.ts";
import {
  extractTicketKeys,
  type FilesFetched,
  type PullRequest,
  type Ticket,
} from "../../domain/review/index.ts";
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

/** Told how many of the PR's files are in hand: once for the cached ones, then per batch. */
export type OnFilesFetched = (progress: FilesFetched) => Promise<void>;

export const collect = async (
  deps: AppDeps,
  host: GitHost,
  pullRequest: PullRequest,
  onFilesFetched: OnFilesFetched = async () => {},
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
  // A file at a commit never changes, so what an earlier attempt fetched is still good.
  const cached = await Promise.all(fetches.map((fetch) => deps.fileCache.get(repo, fetch)));
  const missing = fetches
    .map((fetch, index) => ({ ...fetch, index }))
    .filter(({ index }) => cached[index] === null);
  const batches = Array.from({ length: Math.ceil(missing.length / FILES_PER_BATCH) }, (_, i) =>
    missing.slice(i * FILES_PER_BATCH, (i + 1) * FILES_PER_BATCH),
  );
  const fetched = new Map<number, string | null>();
  let done = fetches.length - missing.length;
  await onFilesFetched({ done, total: fetches.length });
  const failures = await mapLimit(batches, BATCH_CONCURRENCY, async (batch) => {
    const contents = await host.getFiles(repo, batch);
    if (!contents.ok) return contents.error;
    // Cached batch by batch, so a later failure keeps what this one fetched.
    for (const [i, file] of batch.entries()) {
      const content = contents.value[i] ?? null;
      fetched.set(file.index, content);
      if (content === null || fitsSize(content) !== null) {
        await deps.fileCache.put(repo, file, content);
      }
    }
    done += batch.length;
    await onFilesFetched({ done, total: fetches.length });
    return null;
  });
  const failure = failures.find((error) => error !== null) ?? null;
  if (failure !== null) {
    return err(
      appError("host-error", `Couldn't fetch the pull request's files: ${failure.message}`),
    );
  }

  let gitattributes: string | null = null;
  const baseContents = new Map<string, string | null>();
  const headContents = new Map<string, string | null>();
  for (const file of files) {
    if (file.status === "added") baseContents.set(file.path, null);
    if (file.status === "deleted") headContents.set(file.path, null);
  }
  for (const [index, { side, path }] of fetches.entries()) {
    const content = fitsSize(cached[index]?.content ?? fetched.get(index) ?? null);
    if (side === "attributes") gitattributes = content;
    else (side === "base" ? baseContents : headContents).set(path, content);
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
