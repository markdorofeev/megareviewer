import type {
  FindingType,
  GuidanceEffect,
  IntentMismatchKind,
} from "../src/domain/review/index.ts";

/** Lines of a hunk, first to last, on the head ("new") or base side. */
export interface LinePlace {
  readonly hunkId: string;
  readonly side: "new" | "old";
  readonly lines: readonly [number, number];
}

/** What looks wrong: a defect, or something the reviewer would ask the author to change. */
export interface ExpectedFinding {
  readonly description: string;
  readonly type: FindingType;
  readonly mustHave: boolean;
  /** Where it may rest: a produced finding is placed when its lines overlap any of these. */
  readonly at: readonly LinePlace[];
  /** The index of the expected mismatch it shows, which the produced finding should name. */
  readonly mismatch?: number;
}

/**
 * What one preference or guideline file of the case's guidance should do to the review. A mark is
 * right only on a finding a label of its ref and effect names, in itself or in `alsoOn`.
 */
export interface ExpectedGuidance {
  /** As the run numbers it: "p1" the case's first preference, "g1" its first guideline file. */
  readonly ref: string;
  /**
   * raised: one of its findings should be found carrying its mark.
   * left-out: each of its findings should be absent, or carry its mark and so be folded.
   */
  readonly effect: GuidanceEffect;
  /** By their index in `findings`. */
  readonly findings: readonly number[];
  /** Findings that may carry the mark too, which the label doesn't ask for. */
  readonly alsoOn?: readonly number[];
}

/** What a reviewer expects the pipeline to produce for one case. */
export interface CaseLabels {
  /** What looks wrong: a defect, or something the reviewer would ask the author to change. */
  readonly findings: readonly ExpectedFinding[];
  /** [] means the case should produce no mismatch at all. */
  readonly mismatches: readonly {
    readonly kind: IntentMismatchKind;
    readonly description: string;
  }[];
  /** For cases with guidance: what each preference or guideline file the labels are about should do. */
  readonly guidance?: readonly ExpectedGuidance[];
  /**
   * The change touches an API or a credential and breaks nothing, so any finding on it is wrong.
   * A case with no labeled finding but without this may hold one nobody labeled.
   */
  readonly nothingWrong?: true;
  /** For cases whose PR text tries to steer the model. */
  readonly injection?: { readonly reported: boolean };
}
