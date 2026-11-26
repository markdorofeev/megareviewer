import type { GuidanceEffect, IntentMismatchKind, ModelPass } from "../src/domain/review/index.ts";

/** "either": a hunk that could fairly go both ways, which counts in no risk metric. */
export type RiskLabel = "logic" | "contract" | "either";

export interface ExpectedPoint {
  readonly description: string;
  readonly mustHave: boolean;
}

/** Lines of a hunk, first to last, on the head ("new") or base side. */
export interface LinePlace {
  readonly hunkId: string;
  readonly side: "new" | "old";
  readonly lines: readonly [number, number];
}

export interface ExpectedFinding extends ExpectedPoint {
  /** Where it may rest: a produced finding is placed when its lines overlap any of these. */
  readonly at: readonly LinePlace[];
  /** The index of the expected mismatch it shows, which the produced finding should name. */
  readonly mismatch?: number;
}

/** Labeled findings by their index in `findings`, and risks by their hunk's ID. */
export interface GuidedPoints {
  readonly findings?: readonly number[];
  readonly risks?: readonly string[];
}

/**
 * What one preference or guideline file of the case's guidance should do to the review. A mark is
 * right only on a point a label of its ref and effect names, in itself or in `alsoOn`.
 */
export interface ExpectedGuidance extends GuidedPoints {
  /** As the run numbers it: "p1" the case's first preference, "g1" its first guideline file. */
  readonly ref: string;
  /**
   * raised: one of its points should be found carrying its mark, a finding or a risk alike.
   * left-out: each of its points should be absent, or carry its mark and so be folded.
   */
  readonly effect: GuidanceEffect;
  /** Points that may carry the mark too, which the label doesn't ask for. */
  readonly alsoOn?: GuidedPoints;
}

/** A file of the harness a pass should open. */
export interface ExpectedRead {
  readonly pass: ModelPass;
  readonly path: string;
}

/** What a reviewer expects the pipeline to produce for one case. */
export interface CaseLabels {
  /** By hunk ID, every hunk the risk pass classifies: every hunk without a mechanical proof. */
  readonly risk: Readonly<Record<string, RiskLabel>>;
  /**
   * For every hunk labeled contract, where its band belongs: the lines its risk is about. A risk is
   * placed when its lines overlap any of them.
   */
  readonly riskAt: Readonly<Record<string, readonly LinePlace[]>>;
  /**
   * By hunk ID, the tests in the PR whose assertions check what the hunk's risk is about: a
   * checking test the model names for its risk is right when its lines overlap one. No entry, or
   * [], means no test in the PR checks it, so naming any is wrong; "either" isn't scored.
   */
  readonly checkedBy?: Readonly<Record<string, readonly LinePlace[] | "either">>;
  /** What looks wrong: a defect, or something the reviewer would ask the author to change. */
  readonly findings: readonly ExpectedFinding[];
  /** Why the code makes a choice a reader would wonder about, as a question starting with "Why". */
  readonly decisions: readonly ExpectedPoint[];
  /** [] means the case should produce no mismatch at all. */
  readonly mismatches: readonly {
    readonly kind: IntentMismatchKind;
    readonly description: string;
  }[];
  /** For cases with guidance: what each preference or guideline file the labels are about should do. */
  readonly guidance?: readonly ExpectedGuidance[];
  /**
   * For cases with files left to be read: the reads a pass should make, by the file's path in the
   * repository. [] means none is asked for.
   */
  readonly reads?: readonly ExpectedRead[];
  /** For cases whose PR text tries to steer the model. */
  readonly injection?: { readonly reported: boolean };
}
