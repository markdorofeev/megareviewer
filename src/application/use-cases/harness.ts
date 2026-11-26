import {
  type BlobHash,
  GUIDELINE_PATHS,
  type Harness,
  type HarnessFile,
  type HarnessLink,
  type HarnessLinkKind,
  type HostError,
  harnessLinks,
  harnessOutline,
  MAX_HARNESS_DEPTH,
  MAX_HARNESS_FILE_BYTES,
  MAX_HARNESS_FILES,
  MAX_HARNESS_LOOKUPS,
  type RepoRef,
  strongerLink,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { HarnessBlob, HarnessSource, HarnessSourceFile } from "../ports/index.ts";
import type { AppDeps } from "./deps.ts";
import { appError, fromHostError, type UseCaseError } from "./errors.ts";

export interface LoadedHarness {
  readonly harness: Harness;
  /** The text of each of the harness's files, by path. */
  readonly contents: ReadonlyMap<string, string>;
}

/** What a path turned out to be; null when it isn't a file at the commit. */
type Found =
  | (Extract<HarnessSourceFile, { kind: "text" }> & { readonly stored: boolean })
  | Extract<HarnessSourceFile, { kind: "skipped" }>
  | null;

/** Reads a commit's files as cheaply as a source and the store allow. */
interface Reader {
  /** Whether a path is a file at the commit, when that's known without asking. */
  knows(path: string): "there" | "absent" | "unknown";
  read(paths: readonly string[]): Promise<Result<ReadonlyMap<string, Found>, HostError>>;
}

type Deps = Pick<AppDeps, "harnessSource" | "harnessStore" | "logger">;

const readFromSource = async (
  source: HarnessSource,
  repo: RepoRef,
  sha: string,
  paths: readonly string[],
): Promise<Result<Map<string, Found>, HostError>> => {
  const found = new Map<string, Found>();
  if (paths.length === 0) return ok(found);
  const read = await source.readFiles(repo, sha, paths);
  if (!read.ok) return read;
  for (const [index, path] of paths.entries()) {
    const file = read.value[index] ?? null;
    found.set(path, file?.kind === "text" ? { ...file, stored: false } : file);
  }
  return ok(found);
};

/** Every path is asked for. */
const walkingReader = (source: HarnessSource, repo: RepoRef, sha: string): Reader => ({
  knows: () => "unknown",
  read: (paths) => readFromSource(source, repo, sha, paths),
});

/** The source listed the commit, so only blobs the store doesn't have are read. */
const listedReader = (
  { harnessStore }: Deps,
  source: HarnessSource,
  repo: RepoRef,
  sha: string,
  listed: ReadonlyMap<string, BlobHash>,
): Reader => ({
  knows: (path) => (listed.has(path) ? "there" : "absent"),
  async read(paths) {
    const blobs = await harnessStore.getBlobs(
      repo,
      paths.flatMap((path) => listed.get(path) ?? []),
    );
    const found = new Map<string, Found>();
    const unread: string[] = [];
    for (const path of paths) {
      const blob = listed.get(path);
      const content = blob === undefined ? undefined : blobs.get(blob);
      if (blob === undefined || content === undefined) unread.push(path);
      else found.set(path, { kind: "text", content, blob, stored: true });
    }
    const read = await readFromSource(source, repo, sha, unread);
    if (!read.ok) return read;
    for (const [path, file] of read.value) {
      const blob = listed.get(path);
      // The listing has it, so one the source doesn't give is there and can't be read.
      if (file === null) found.set(path, { kind: "skipped", reason: "unreadable" });
      else if (file.kind === "text" && blob !== undefined) found.set(path, { ...file, blob });
      else found.set(path, file);
    }
    return ok(found);
  },
});

/** What an earlier harness knows still holds but for the paths changed since, which are read. */
const changedReader = async (
  { harnessStore }: Deps,
  source: HarnessSource,
  repo: RepoRef,
  sha: string,
  earlier: Harness,
  changed: ReadonlySet<string>,
): Promise<Reader> => {
  const known = new Map<string, Found>();
  const same = earlier.files.filter((file) => !changed.has(file.path));
  const blobs = await harnessStore.getBlobs(
    repo,
    same.map((file) => file.blob),
  );
  for (const { path, blob } of same) {
    const content = blobs.get(blob);
    if (content !== undefined) known.set(path, { kind: "text", content, blob, stored: true });
  }
  for (const { path, reason } of earlier.skipped) {
    if (!changed.has(path)) known.set(path, { kind: "skipped", reason });
  }
  for (const path of earlier.missing) if (!changed.has(path)) known.set(path, null);
  return {
    knows(path) {
      const found = known.get(path);
      return found === undefined ? "unknown" : found === null ? "absent" : "there";
    },
    async read(paths) {
      const read = await readFromSource(
        source,
        repo,
        sha,
        paths.filter((path) => !known.has(path)),
      );
      if (!read.ok) return read;
      return ok(
        new Map(paths.map((path) => [path, read.value.get(path) ?? known.get(path) ?? null])),
      );
    },
  };
};

const readerFor = async (
  deps: Deps,
  source: HarnessSource,
  repo: RepoRef,
  sha: string,
): Promise<Result<Reader, HostError>> => {
  const listed = await source.listFiles(repo, sha);
  if (!listed.ok) return listed;
  if (listed.value !== null) return ok(listedReader(deps, source, repo, sha, listed.value));
  const latest = await deps.harnessStore.latestHarness(repo);
  if (latest === null) return ok(walkingReader(source, repo, sha));
  const changed =
    latest.baseSha === sha ? ok([]) : await source.changedPaths(repo, latest.baseSha, sha);
  if (changed.ok && changed.value !== null) {
    return ok(await changedReader(deps, source, repo, sha, latest, new Set(changed.value)));
  }
  // The commit of the latest harness can be gone, after a force-push.
  return changed.ok || changed.error.kind === "not-found"
    ? ok(walkingReader(source, repo, sha))
    : changed;
};

interface FoundLink extends Omit<HarnessLink, "kind"> {
  readonly kind: HarnessLinkKind | "root";
  readonly from: string | null;
}

interface WalkedFile extends Omit<HarnessFile, "via" | "linkedFrom" | "links"> {
  via: HarnessFile["via"];
  readonly linkedFrom: string | null;
  readonly links: Map<string, HarnessLinkKind>;
}

const utf8 = new TextEncoder();

interface Walked extends LoadedHarness {
  /** What the source gave, to store. */
  readonly fetched: readonly HarnessBlob[];
}

/** Reads the roots and then, hop by hop, the files they link, up to the limits. */
const walk = async (baseSha: string, reader: Reader): Promise<Result<Walked, HostError>> => {
  const outcomes = new Map<string, Found>();
  const files = new Map<string, WalkedFile>();
  const contents = new Map<string, string>();
  const fetched: HarnessBlob[] = [];
  const skipped = new Map<string, Harness["skipped"][number]>();
  let lookups = MAX_HARNESS_LOOKUPS;
  let cut: Harness["cut"] = null;
  let hop: FoundLink[] = GUIDELINE_PATHS.map((path) => ({
    kind: "root",
    paths: [path],
    from: null,
  }));

  /** The paths a hop needs read, up to the limits on files and on lookups. */
  const wantedOf = (links: readonly FoundLink[]): Set<string> => {
    const wanted = new Set<string>();
    let room = MAX_HARNESS_FILES - files.size;
    for (const { paths } of links) {
      for (const path of paths) {
        const outcome = outcomes.get(path);
        if (outcome === null) continue;
        if (outcome !== undefined) break;
        const known = reader.knows(path);
        if (known === "absent") {
          outcomes.set(path, null);
          continue;
        }
        if (!wanted.has(path)) {
          if (known === "there" ? room === 0 : lookups === 0) {
            cut = "files";
            return wanted;
          }
          if (known === "there") room -= 1;
          else lookups -= 1;
          wanted.add(path);
        }
        if (known === "there") break;
      }
    }
    return wanted;
  };

  /** The file a link means: the first of its paths that's one, unless one before it wasn't read. */
  const meant = ({ paths }: FoundLink): string | null => {
    for (const path of paths) {
      const outcome = outcomes.get(path);
      if (outcome === undefined) return null;
      if (outcome !== null) return path;
    }
    return null;
  };

  const connect = (link: FoundLink, file: WalkedFile): void => {
    const linking = link.from === null ? undefined : files.get(link.from);
    if (linking === undefined || link.kind === "root") return;
    const earlier = linking.links.get(file.path);
    linking.links.set(
      file.path,
      earlier === undefined ? link.kind : strongerLink(earlier, link.kind),
    );
    if (file.via !== "root") file.via = strongerLink(file.via, link.kind);
  };

  for (let depth = 0; hop.length > 0 && depth <= MAX_HARNESS_DEPTH && cut === null; depth += 1) {
    const wanted = wantedOf(hop);
    const read = await reader.read([...wanted]);
    if (!read.ok) return read;
    for (const path of wanted) {
      const found = read.value.get(path) ?? null;
      const large =
        found?.kind === "text" && utf8.encode(found.content).byteLength > MAX_HARNESS_FILE_BYTES;
      outcomes.set(path, large ? { kind: "skipped", reason: "too-large" } : found);
    }
    const next: FoundLink[] = [];
    for (const link of hop) {
      const path = meant(link);
      const outcome = path === null ? null : (outcomes.get(path) ?? null);
      if (path === null || outcome === null) continue;
      if (outcome.kind === "skipped") {
        skipped.set(path, { path, reason: outcome.reason });
        continue;
      }
      let file = files.get(path);
      if (file === undefined) {
        if (files.size === MAX_HARNESS_FILES) {
          cut = "files";
          continue;
        }
        const { content, blob } = outcome;
        file = {
          path,
          blob,
          bytes: utf8.encode(content).byteLength,
          ...harnessOutline(content),
          via: link.kind,
          linkedFrom: link.from,
          links: new Map(),
        };
        files.set(path, file);
        contents.set(path, content);
        if (!outcome.stored) fetched.push({ blob, content });
        next.push(...harnessLinks(path, content).map((found) => ({ ...found, from: path })));
      }
      connect(link, file);
    }
    hop = next;
  }

  // Links past a limit still connect files the harness has.
  for (const link of hop) {
    const path = link.paths.find((candidate) => files.has(candidate));
    const file = path === undefined ? undefined : files.get(path);
    if (file !== undefined) connect(link, file);
    else if (
      link.paths.some((candidate) => {
        const outcome = outcomes.get(candidate);
        return outcome === undefined && reader.knows(candidate) !== "absent";
      })
    ) {
      cut ??= "depth";
    }
  }

  return ok({
    harness: {
      baseSha,
      files: [...files.values()].map((file) => ({
        ...file,
        links: [...file.links].map(([path, kind]) => ({ path, kind })),
      })),
      cut,
      skipped: [...skipped.values()],
      missing: [...outcomes].flatMap(([path, outcome]) => (outcome === null ? [path] : [])),
    },
    contents,
    fetched,
  });
};

/** A harness already stored with all its contents, or null. */
const storedHarness = async (
  { harnessStore }: Deps,
  repo: RepoRef,
  sha: string,
): Promise<LoadedHarness | null> => {
  const harness = await harnessStore.getHarness(repo, sha);
  if (harness === null) return null;
  const blobs = await harnessStore.getBlobs(
    repo,
    harness.files.map((file) => file.blob),
  );
  const contents = new Map<string, string>();
  for (const { path, blob } of harness.files) {
    const content = blobs.get(blob);
    if (content === undefined) return null;
    contents.set(path, content);
  }
  return { harness, contents };
};

const load = async (
  deps: Deps,
  repo: RepoRef,
  sha: string,
): Promise<Result<LoadedHarness | null, UseCaseError>> => {
  const source = deps.harnessSource(repo);
  if (source === null) return ok(null);
  const stored = await storedHarness(deps, repo, sha);
  if (stored !== null) return ok(stored);
  const reader = await readerFor(deps, source, repo, sha);
  if (!reader.ok) return err(fromHostError(reader.error));
  const walked = await walk(sha, reader.value);
  if (!walked.ok) return err(fromHostError(walked.error));
  const { harness, contents, fetched } = walked.value;
  try {
    // Contents first: a harness in the store is taken to have them.
    await deps.harnessStore.putBlobs(repo, fetched);
    await deps.harnessStore.putHarness(repo, harness);
  } catch (error) {
    deps.logger.error("Couldn't store the repository's harness", { repo, sha, error });
  }
  return ok({ harness, contents });
};

interface Loads {
  readonly inFlight: Map<string, Promise<Result<LoadedHarness | null, UseCaseError>>>;
  /** The loads whose last try failed, with why. */
  readonly failed: Map<string, UseCaseError>;
}

/** By the store they write into, so whatever starts a load joins one already writing there. */
const loadsByStore = new WeakMap<AppDeps["harnessStore"], Loads>();

const loadsOf = ({ harnessStore }: Pick<AppDeps, "harnessStore">): Loads => {
  const loads = loadsByStore.get(harnessStore) ?? { inFlight: new Map(), failed: new Map() };
  loadsByStore.set(harnessStore, loads);
  return loads;
};

const loadKey = ({ host, owner, repo }: RepoRef, sha: string): string =>
  `${host}/${owner}/${repo}@${sha}`;

/**
 * A repository's harness at a PR's base commit with its files' contents, from the store when it's
 * there and else from the repository's source, joining a load already running. Null when the
 * repository has no source. Never throws.
 */
export const loadHarness = async (
  deps: Deps,
  repo: RepoRef,
  baseSha: string,
): Promise<Result<LoadedHarness | null, UseCaseError>> => {
  const { inFlight, failed } = loadsOf(deps);
  const key = loadKey(repo, baseSha);
  const running = inFlight.get(key);
  if (running !== undefined) return running;
  const loading = load(deps, repo, baseSha)
    .then((loaded) => {
      if (!loaded.ok) {
        deps.logger.warn("Couldn't load the repository's harness", {
          repo,
          sha: baseSha,
          error: loaded.error.message,
        });
      }
      return loaded;
    })
    .catch((error: unknown) => {
      deps.logger.error("Couldn't load the repository's harness", { repo, sha: baseSha, error });
      return err(appError("internal", "Couldn't load the repository's harness"));
    })
    .then((loaded) => {
      if (loaded.ok) failed.delete(key);
      else failed.set(key, loaded.error);
      inFlight.delete(key);
      return loaded;
    });
  inFlight.set(key, loading);
  return loading;
};

/** Where a harness's load stands. "none": nothing has loaded it. */
export type HarnessState =
  | { readonly status: "loading" | "none" }
  | { readonly status: "ready"; readonly harness: Harness }
  | { readonly status: "failed"; readonly error: UseCaseError };

/** Where the load of a repository's harness at a commit stands, without starting one. */
export const harnessState = async (
  deps: Pick<AppDeps, "harnessStore">,
  repo: RepoRef,
  baseSha: string,
): Promise<HarnessState> => {
  const { inFlight, failed } = loadsOf(deps);
  const key = loadKey(repo, baseSha);
  if (inFlight.has(key)) return { status: "loading" };
  const error = failed.get(key);
  if (error !== undefined) return { status: "failed", error };
  const harness = await deps.harnessStore.getHarness(repo, baseSha);
  return harness === null ? { status: "none" } : { status: "ready", harness };
};
