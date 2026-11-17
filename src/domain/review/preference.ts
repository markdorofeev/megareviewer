import { z } from "zod";
import { fnv1a64 } from "../shared/index.ts";
import { PointKind } from "./point-kind.ts";
import { Timestamp } from "./primitives.ts";
import { PullRequestRef, RepoRef } from "./pull-request.ts";

export const PreferenceId = z
  .string()
  .regex(/^pref_[0-9a-f]{16}$/)
  .brand<"PreferenceId">();
export type PreferenceId = z.infer<typeof PreferenceId>;

export const ProposalId = z
  .string()
  .regex(/^prop_[0-9a-f]{16}$/)
  .brand<"ProposalId">();
export type ProposalId = z.infer<typeof ProposalId>;

/** look-for: what an AI review should check for. dont-flag: what it should leave out. */
export const PreferenceKind = z.enum(["look-for", "dont-flag"]);
export type PreferenceKind = z.infer<typeof PreferenceKind>;

export const PreferenceScope = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("global") }),
    z.object({ kind: z.literal("repo"), repo: RepoRef }),
  ])
  .readonly();
export type PreferenceScope = z.infer<typeof PreferenceScope>;

/** written by the reviewer, learned from what they did here, or imported from their past reviews. */
export const PreferenceSource = z.enum(["written", "learned", "imported"]);
export type PreferenceSource = z.infer<typeof PreferenceSource>;

export const MAX_PREFERENCE_TEXT = 300;

export const PreferenceText = z.string().trim().min(1).max(MAX_PREFERENCE_TEXT);
export type PreferenceText = z.infer<typeof PreferenceText>;

/** A rule of the reviewer's for an AI review. Only an enabled one is sent to the model. */
export const Preference = z
  .object({
    id: PreferenceId,
    kind: PreferenceKind,
    text: PreferenceText,
    scope: PreferenceScope,
    source: PreferenceSource,
    enabled: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .readonly();
export type Preference = z.infer<typeof Preference>;

export const MAX_EVIDENCE_LINES = 5;

/**
 * A preference megareviewer proposes, from what the reviewer did or from their past comments. It's
 * used only once the reviewer accepts it. Its text is a model's, so it can be longer than a
 * preference's: accepting it then needs an edit.
 */
export const PreferenceProposal = z
  .object({
    id: ProposalId,
    kind: PreferenceKind,
    text: z.string().trim().min(1),
    scope: PreferenceScope,
    source: z.enum(["learned", "imported"]),
    /** What it's based on: "Dismissed: Missing JSDoc on `parseConfig`, acme/api #12". */
    evidence: z.array(z.string()).max(MAX_EVIDENCE_LINES).readonly(),
    status: z.enum(["pending", "accepted", "rejected"]),
    createdAt: Timestamp,
  })
  .readonly();
export type PreferenceProposal = z.infer<typeof PreferenceProposal>;

/**
 * Something the reviewer did that says what they value, with the text as it was then. For a point,
 * `title` and `text` are its title and explanation; for a comment, `title` is empty and `text` its
 * body.
 */
export const ReviewSignal = z
  .object({
    kind: z.enum(["dismissed", "raised", "comment"]),
    at: Timestamp,
    pullRequest: PullRequestRef,
    pointKind: PointKind.nullable(),
    title: z.string(),
    text: z.string(),
    path: z.string().nullable(),
  })
  .readonly();
export type ReviewSignal = z.infer<typeof ReviewSignal>;

/** What made a signal, so a retry writes it once and reopening a point removes it. */
export const SignalKey = z.string().min(1).brand<"SignalKey">();
export type SignalKey = z.infer<typeof SignalKey>;

/** A comment the reviewer wrote on a pull request's code before, as its host has it. */
export const PastComment = z
  .object({
    pullRequest: PullRequestRef,
    path: z.string().nullable(),
    body: z.string(),
    at: Timestamp,
  })
  .readonly();
export type PastComment = z.infer<typeof PastComment>;

/** Where a repository's guidelines for writing and reviewing code are looked for, at its root. */
export const GUIDELINE_PATHS = [
  "REVIEW.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  ".github/copilot-instructions.md",
] as const;
export const GuidelinePath = z.enum(GUIDELINE_PATHS);
export type GuidelinePath = z.infer<typeof GuidelinePath>;

/** On unless switched off; the others are about writing code and can be long, so they're off. */
export const DEFAULT_GUIDELINE_PATH: GuidelinePath = "REVIEW.md";
/** A larger file isn't sent: cutting it would drop rules without saying which. */
export const MAX_GUIDELINE_BYTES = 32_768;
/** Per scope: everywhere, and each repository. */
export const MAX_ENABLED_PREFERENCES = 50;

/** A guideline file a repository has, and whether a model run reads it. */
export const GuidelineFile = z
  .object({
    path: GuidelinePath,
    bytes: z.number().int().nonnegative(),
    enabled: z.boolean(),
    /** Over MAX_GUIDELINE_BYTES: never sent, whatever `enabled` says. */
    tooLarge: z.boolean(),
  })
  .readonly();
export type GuidelineFile = z.infer<typeof GuidelineFile>;

/** "p1" for a model run's first preference, "g1" for its first guideline file. */
export const GuidanceRef = z.string().regex(/^[pg][1-9][0-9]*$/);
export type GuidanceRef = z.infer<typeof GuidanceRef>;

/** What one model run was given, kept so a point's mark stays right after a preference changes. */
export const Guidance = z
  .object({
    preferences: z
      .array(
        z
          .object({
            ref: GuidanceRef,
            id: PreferenceId,
            kind: PreferenceKind,
            text: z.string(),
            scope: PreferenceScope,
          })
          .readonly(),
      )
      .readonly(),
    guidelines: z
      .array(
        z
          .object({ ref: GuidanceRef, path: z.string(), bytes: z.number().int().nonnegative() })
          .readonly(),
      )
      .readonly(),
  })
  .readonly();
export type Guidance = z.infer<typeof Guidance>;

/** raised: the guidance led to the point. left-out: the guidance says not to flag it. */
export const GuidanceEffect = z.enum(["raised", "left-out"]);
export type GuidanceEffect = z.infer<typeof GuidanceEffect>;

/** The model's word that a preference or a guideline file shaped a finding or a risk. */
export const GuidanceMark = z.object({ ref: GuidanceRef, effect: GuidanceEffect }).readonly();
export type GuidanceMark = z.infer<typeof GuidanceMark>;

const scopeKey = (scope: PreferenceScope): string =>
  scope.kind === "global" ? "global" : `${scope.repo.host}/${scope.repo.owner}/${scope.repo.repo}`;

export const sameRepo = (a: RepoRef, b: RepoRef): boolean =>
  a.host === b.host && a.owner === b.owner && a.repo === b.repo;

export const sameScope = (a: PreferenceScope, b: PreferenceScope): boolean =>
  scopeKey(a) === scopeKey(b);

/** In the order they were made; ones made at the same time keep the order they're given in. */
export const inCreationOrder = <T extends { readonly createdAt: Timestamp }>(
  items: readonly T[],
): T[] => [...items].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

/** What a model run on a pull request of `repo` reads: the enabled ones, everywhere's first. */
export const preferencesFor = (preferences: readonly Preference[], repo: RepoRef): Preference[] => {
  const enabled = inCreationOrder(preferences.filter((preference) => preference.enabled));
  return [
    ...enabled.filter((preference) => preference.scope.kind === "global"),
    ...enabled.filter(
      (preference) => preference.scope.kind === "repo" && sameRepo(preference.scope.repo, repo),
    ),
  ];
};

/** Whether one more preference can be enabled in `scope`; `except` is the one being changed. */
export const canEnable = (
  preferences: readonly Preference[],
  scope: PreferenceScope,
  except: PreferenceId | null = null,
): boolean =>
  preferences.filter(
    (preference) =>
      preference.enabled && preference.id !== except && sameScope(preference.scope, scope),
  ).length < MAX_ENABLED_PREFERENCES;

/** Whether a run reads a guideline file, by the reviewer's switch for it or else its default. */
export const guidelineEnabled = (path: string, switches: ReadonlyMap<string, boolean>): boolean =>
  switches.get(path) ?? path === DEFAULT_GUIDELINE_PATH;

const utf8 = new TextEncoder();

export const guidelineFile = (
  path: GuidelinePath,
  content: string,
  switches: ReadonlyMap<string, boolean>,
): GuidelineFile => {
  const bytes = utf8.encode(content).byteLength;
  return {
    path,
    bytes,
    enabled: guidelineEnabled(path, switches),
    tooLarge: bytes > MAX_GUIDELINE_BYTES,
  };
};

/** Numbers what a run reads, in the order it's sent. */
export const guidanceOf = (
  preferences: readonly Preference[],
  guidelines: readonly { readonly path: string; readonly bytes: number }[],
): Guidance => ({
  preferences: preferences.map(({ id, kind, text, scope }, index) => ({
    ref: `p${index + 1}`,
    id,
    kind,
    text,
    scope,
  })),
  guidelines: guidelines.map(({ path, bytes }, index) => ({ ref: `g${index + 1}`, path, bytes })),
});

/** What a checked mark says on a point: the preference's text, or the guideline file's path. */
export interface PointGuidance {
  readonly effect: GuidanceEffect;
  readonly label: string;
  /** Null for a guideline file. */
  readonly preferenceId: PreferenceId | null;
}

/**
 * A mark as the page shows it, or null for one that doesn't check out: a ref the run didn't have,
 * "left-out" by a look-for preference or "raised" by a dont-flag one. A guideline file takes
 * either. The point keeps its place without the mark: unsure, the page shows more.
 */
export const resolveGuidanceMark = (
  mark: GuidanceMark | null,
  guidance: Guidance | null,
): PointGuidance | null => {
  if (mark === null || guidance === null) return null;
  const file = guidance.guidelines.find((guideline) => guideline.ref === mark.ref);
  if (file !== undefined) return { effect: mark.effect, label: file.path, preferenceId: null };
  const preference = guidance.preferences.find((candidate) => candidate.ref === mark.ref);
  if (preference === undefined) return null;
  const effect: GuidanceEffect = preference.kind === "look-for" ? "raised" : "left-out";
  return mark.effect === effect
    ? { effect, label: preference.text, preferenceId: preference.id }
    : null;
};

/** The mark when it checks out against what the run was given, else null. */
export const checkGuidanceMark = (
  mark: GuidanceMark | null,
  guidance: Guidance | null,
): GuidanceMark | null => (resolveGuidanceMark(mark, guidance) === null ? null : mark);

/** Whether a line of evidence names a repository, as "owner/repo" and not as part of a longer name. */
const names = (line: string, { owner, repo }: RepoRef): boolean => {
  const name = `${owner}/${repo}`;
  for (let at = line.indexOf(name); at !== -1; at = line.indexOf(name, at + 1)) {
    const before = line[at - 1] ?? " ";
    const after = line.slice(at + name.length, at + name.length + 2);
    if (!/[\w./-]/.test(before) && !/^(?:[\w-]|\.\w)/.test(after)) return true;
  }
  return false;
};

/**
 * The repository a proposal drafted for "this repository" means, among those its evidence could be
 * from: the only one there is, or else the one every line of its evidence names. Null when a line
 * names none or more than one, where the proposal is for every repository: the reviewer reads the
 * scope before accepting it.
 */
export const evidenceRepo = (
  evidence: readonly string[],
  repos: readonly RepoRef[],
): RepoRef | null => {
  const distinct = repos.filter(
    (repo, index) => repos.findIndex((other) => sameRepo(other, repo)) === index,
  );
  const [only] = distinct;
  if (distinct.length === 1 && only !== undefined) return only;
  const named = evidence.map((line) => distinct.filter((repo) => names(line, repo)));
  const first = named[0]?.[0];
  return first !== undefined &&
    named.every((found) => {
      const [repo] = found;
      return found.length === 1 && repo !== undefined && sameRepo(repo, first);
    })
    ? first
    : null;
};

/** Two rules that say the same, whatever their case and spacing. */
export const sameRule = (
  a: { readonly kind: PreferenceKind; readonly text: string },
  b: { readonly kind: PreferenceKind; readonly text: string },
): boolean => {
  const said = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
  return a.kind === b.kind && said(a.text) === said(b.text);
};

const freshId = (prefix: string, seed: string, taken: ReadonlySet<string>): string => {
  for (let salt = 0; ; salt += 1) {
    const id = `${prefix}_${fnv1a64(`${seed}#${salt}`)}`;
    if (!taken.has(id)) return id;
  }
};

type Seed = Pick<Preference, "kind" | "text" | "scope" | "createdAt">;
const seedOf = ({ kind, text, scope, createdAt }: Seed): string =>
  `${createdAt}|${kind}|${scopeKey(scope)}|${text}`;

/** Named by what it says and when it was made, as analyses are; `taken` are the IDs in use. */
export const preferenceId = (seed: Seed, taken: ReadonlySet<string>): PreferenceId =>
  PreferenceId.parse(freshId("pref", seedOf(seed), taken));

export const proposalId = (seed: Seed, taken: ReadonlySet<string>): ProposalId =>
  ProposalId.parse(freshId("prop", seedOf(seed), taken));
