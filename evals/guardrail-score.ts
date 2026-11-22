import type { Guardrail } from "../src/domain/review/index.ts";
import type { AcceptedGuardrail } from "./guardrail-cases.ts";

export interface Count {
  readonly hit: number;
  readonly total: number;
}

export interface GuardrailCallScore {
  /** Labeled guardrails a point got as one the label accepts, of all labeled guardrails. */
  readonly guardrailRight: Count;
  /**
   * Marks on points labeled none, and verified rules no accepted guardrail of their point lists,
   * of all marks the server kept.
   */
  readonly guardrailWrong: Count;
}

export const TARGETS = {
  guardrailRight: { min: 0.9 },
  guardrailWrong: { maxHits: 0 },
} as const;

const accepts = (accepted: AcceptedGuardrail, guardrail: Guardrail): boolean =>
  accepted.is === "rule"
    ? guardrail.is === "rule" &&
      guardrail.tool === accepted.tool &&
      accepted.rules.some((rule) => rule.toLowerCase() === guardrail.rule.toLowerCase())
    : guardrail.is === "suggested" && accepted.kinds.includes(guardrail.kind);

/** A verified rule no accepted guardrail names: the model's word on a rule that may not exist. */
const unlistedRule = (accepted: readonly AcceptedGuardrail[], guardrail: Guardrail): boolean =>
  guardrail.is === "rule" && !accepted.some((one) => accepts(one, guardrail));

/** One case's score: what the server kept, by point ref, against its labels. */
export const scoreGuardrailCase = (
  kept: ReadonlyMap<string, Guardrail>,
  labels: Readonly<Record<string, readonly AcceptedGuardrail[] | null>>,
): GuardrailCallScore => {
  const labeled = Object.entries(labels).flatMap(([ref, accepted]) =>
    accepted === null ? [] : [{ ref, accepted }],
  );
  const right = labeled.filter(({ ref, accepted }) => {
    const guardrail = kept.get(ref);
    return guardrail !== undefined && accepted.some((one) => accepts(one, guardrail));
  });
  const wrong = [...kept].filter(([ref, guardrail]) => {
    const accepted = labels[ref];
    return accepted === null || accepted === undefined || unlistedRule(accepted, guardrail);
  });
  return {
    guardrailRight: { hit: right.length, total: labeled.length },
    guardrailWrong: { hit: wrong.length, total: kept.size },
  };
};

const add = (a: Count, b: Count): Count => ({ hit: a.hit + b.hit, total: a.total + b.total });

export const sumScores = (scores: readonly GuardrailCallScore[]): GuardrailCallScore =>
  scores.reduce(
    (sum, score) => ({
      guardrailRight: add(sum.guardrailRight, score.guardrailRight),
      guardrailWrong: add(sum.guardrailWrong, score.guardrailWrong),
    }),
    { guardrailRight: { hit: 0, total: 0 }, guardrailWrong: { hit: 0, total: 0 } },
  );

const rate = ({ hit, total }: Count): number => (total === 0 ? 0 : hit / total);

/** Whether each metric meets its target. */
export const meetsTargets = (
  score: GuardrailCallScore,
): Readonly<Record<keyof typeof TARGETS, boolean>> => ({
  guardrailRight: rate(score.guardrailRight) >= TARGETS.guardrailRight.min,
  guardrailWrong: score.guardrailWrong.hit <= TARGETS.guardrailWrong.maxHits,
});
