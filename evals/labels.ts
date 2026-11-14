import type { IntentMismatchKind } from "../src/domain/review/index.ts";

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

/** What a reviewer expects the pipeline to produce for one case. */
export interface CaseLabels {
  /** By hunk ID, every hunk the risk pass classifies: every hunk without a mechanical proof. */
  readonly risk: Readonly<Record<string, RiskLabel>>;
  /**
   * For every hunk labeled contract, where its band belongs: the lines its risk is about. A risk is
   * placed when its lines overlap any of them.
   */
  readonly riskAt: Readonly<Record<string, readonly LinePlace[]>>;
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
