import type { PreferenceStore } from "../src/application/ports/index.ts";
import type {
  FakeGitHost,
  FakeHarnessSource,
  PullRequestFixture,
} from "../src/application/testing/index.ts";
import {
  type GuidelinePath,
  type PreferenceKind,
  type PreferenceScope,
  PreferenceText,
  preferenceId,
} from "../src/domain/review/index.ts";

/**
 * What a run of a case reads beside the PR. Both lists are in the order a run numbers them, which
 * the labels' refs name: preferences p1, p2, … with everywhere's before the repository's, guideline
 * files g1, … in GUIDELINE_PATHS order, then the files they import, then the ones left to be read.
 */
export interface CaseGuidance {
  /** The reviewer's enabled preferences. */
  readonly preferences: readonly {
    readonly kind: PreferenceKind;
    readonly text: string;
    readonly scope: "global" | "repo";
  }[];
  /** The repository's guideline files at the PR's base commit, which the diff doesn't touch. */
  readonly guidelines: readonly { readonly path: GuidelinePath; readonly content: string }[];
  /** The files the guideline files import, breadth-first in the order they're written. */
  readonly imported?: readonly { readonly path: string; readonly content: string }[];
  /** The files those link, which a pass with the read tool can open, nearest a root first. */
  readonly linked?: readonly LinkedFile[];
}

/** A file on this machine, outside every harness, that a case's PR asks a reviewer to read. */
export interface OutsideFile {
  readonly path: string;
  readonly content: string;
  /** Words of it that nothing else in a run has. */
  readonly canary: string;
}

export interface LinkedFile {
  readonly path: string;
  readonly content: string;
  /** What the judge reads of it: the rule the labels are about, where the whole would be too long. */
  readonly rule?: string;
}

const FIRST_MADE_AT = Date.parse("2026-01-01T00:00:00.000Z");

/**
 * Puts a case's guidance where a model run looks for it: the preferences in the reviewer's store,
 * the guideline files on the host at the PR's base commit, each switched on, and in the repository's
 * harness with the files they import and link.
 */
export const giveGuidance = async (
  guidance: CaseGuidance,
  fixture: PullRequestFixture,
  to: {
    readonly host: FakeGitHost;
    readonly harnessSource: FakeHarnessSource;
    readonly preferences: PreferenceStore;
  },
): Promise<void> => {
  const { repo } = fixture.pullRequest.ref;
  const taken = new Set<string>();
  for (const [index, { kind, text, scope }] of guidance.preferences.entries()) {
    // A second apart, so the store lists them in the case's order.
    const madeAt = new Date(FIRST_MADE_AT + index * 1000).toISOString();
    const where: PreferenceScope = scope === "global" ? { kind: "global" } : { kind: "repo", repo };
    const seed = { kind, text: PreferenceText.parse(text), scope: where, createdAt: madeAt };
    const id = preferenceId(seed, taken);
    taken.add(id);
    await to.preferences.savePreference({
      ...seed,
      id,
      source: "written",
      enabled: true,
      updatedAt: madeAt,
    });
  }
  const { baseSha } = fixture.pullRequest;
  const files = [...guidance.guidelines, ...(guidance.imported ?? []), ...(guidance.linked ?? [])];
  const contents = Object.fromEntries(files.map(({ path, content }) => [path, content]));
  to.host.setFiles(repo, baseSha, contents);
  to.harnessSource.setFiles(repo, baseSha, contents);
  for (const { path } of guidance.guidelines) {
    await to.preferences.setGuidelineSwitch(repo, path, true);
  }
};
