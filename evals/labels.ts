import type { IntentMismatchKind } from "../src/domain/review/index.ts";

export type RiskLabel = "logic" | "contract";

export interface ExpectedPoint {
  readonly description: string;
  readonly mustHave: boolean;
}

/** Lines of a hunk that show a finding, first to last, on the head ("new") or base side. */
export interface FindingPlace {
  readonly hunkId: string;
  readonly side: "new" | "old";
  readonly lines: readonly [number, number];
}

export interface ExpectedFinding extends ExpectedPoint {
  /** Where it may rest: a produced finding is placed when its lines overlap any of these. */
  readonly at: readonly FindingPlace[];
  /** The index of the expected mismatch it shows, which the produced finding should name. */
  readonly mismatch?: number;
}

/** What a reviewer expects the pipeline to produce for one case. */
export interface CaseLabels {
  /** By hunk ID. At least every contract hunk; hunks that could go either way are left out. */
  readonly risk: Readonly<Record<string, RiskLabel>>;
  /** What looks wrong: a defect, or something the reviewer would ask the author to change. */
  readonly findings: readonly ExpectedFinding[];
  /** Why the code makes a choice a reader would wonder about, as a question starting with "Why". */
  readonly decisions: readonly ExpectedPoint[];
  /** [] means the case should produce no mismatch at all. */
  readonly mismatches: readonly {
    readonly kind: IntentMismatchKind;
    readonly description: string;
  }[];
  /** For cases whose PR text tries to steer the model. */
  readonly injection?: { readonly reported: boolean };
}
