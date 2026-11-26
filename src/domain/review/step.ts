import { z } from "zod";
import { type Hunk, type HunkId, hunkHasLine } from "../diff/index.ts";
import { PointLines } from "./point-lines.ts";

/** "t1", "t2", … in tour order. */
export const StepId = z
  .string()
  .regex(/^t[1-9][0-9]*$/)
  .brand<"StepId">();
export type StepId = z.infer<typeof StepId>;

/** Fewer steps than this aren't a tour: the change is told in its brief. */
export const MIN_STEPS = 3;
export const MAX_STEPS = 7;

/**
 * A place on the page's tour: one sentence of what the change makes true, and the lines that show
 * it, in one place or two.
 */
export const Step = z
  .object({
    id: StepId,
    sentence: z.string().min(1),
    excerpts: z.array(PointLines).min(1).max(2).readonly(),
  })
  .readonly();
export type Step = z.infer<typeof Step>;

/** A step as the model writes it; the server numbers them. */
export const StepDraft = Step.unwrap().omit({ id: true }).readonly();
export type StepDraft = z.infer<typeof StepDraft>;

/** What can be wrong with the steps the model wrote, by step and excerpt index. */
export type StepProblem =
  | {
      readonly kind: "unknown-hunk" | "mechanical" | "lines-outside";
      readonly step: number;
      readonly excerpt: number;
      readonly hunkId: HunkId;
    }
  /** Its two excerpts show some of the same lines. */
  | { readonly kind: "overlap"; readonly step: number }
  | { readonly kind: "too-many"; readonly step: number };

export interface StepContext {
  readonly hunks: ReadonlyMap<HunkId, Hunk>;
  /** Hunks with a mechanical proof, which the model was sent as stats only. */
  readonly mechanical: ReadonlySet<HunkId>;
}

const excerptProblem = (
  excerpt: PointLines,
  { hunks, mechanical }: StepContext,
): "unknown-hunk" | "mechanical" | "lines-outside" | null => {
  const hunk = hunks.get(excerpt.hunkId);
  if (hunk === undefined) return "unknown-hunk";
  if (mechanical.has(excerpt.hunkId)) return "mechanical";
  return hunkHasLine(hunk, excerpt.side, excerpt.startLine) &&
    hunkHasLine(hunk, excerpt.side, excerpt.line)
    ? null
    : "lines-outside";
};

/** The rows of its hunk an excerpt shows, from its first line to its last, as the page draws it. */
const rowsOf = (excerpt: PointLines, hunk: Hunk): { start: number; end: number } | null => {
  const shown = hunk.lines.flatMap((line, index) => {
    const number = excerpt.side === "new" ? line.newLine : line.oldLine;
    return number !== null && number >= excerpt.startLine && number <= excerpt.line ? [index] : [];
  });
  const [first] = shown;
  const last = shown.at(-1);
  return first === undefined || last === undefined ? null : { start: first, end: last + 1 };
};

const overlap = ([first, second]: readonly PointLines[], { hunks }: StepContext): boolean => {
  if (first === undefined || second === undefined || first.hunkId !== second.hunkId) return false;
  const hunk = hunks.get(first.hunkId);
  const a = hunk === undefined ? null : rowsOf(first, hunk);
  const b = hunk === undefined ? null : rowsOf(second, hunk);
  return a !== null && b !== null && a.start < b.end && b.start < a.end;
};

/**
 * Every problem with the model's steps: excerpts on hunks it wasn't sent in full or on lines
 * their hunk doesn't show, two excerpts of a step on the same lines, and steps past the seventh.
 * Their order is the model's, by what matters most, and nothing checks it.
 */
export const validateSteps = (steps: readonly StepDraft[], context: StepContext): StepProblem[] => [
  ...steps.flatMap((step, index): StepProblem[] => {
    const excerpts = step.excerpts.flatMap((excerpt, at): StepProblem[] => {
      const kind = excerptProblem(excerpt, context);
      return kind === null ? [] : [{ kind, step: index, excerpt: at, hunkId: excerpt.hunkId }];
    });
    return overlap(step.excerpts, context)
      ? [...excerpts, { kind: "overlap", step: index }]
      : excerpts;
  }),
  ...steps.slice(MAX_STEPS).map((_, at) => ({ kind: "too-many" as const, step: MAX_STEPS + at })),
];

/**
 * The steps kept after the retry, numbered: a bad excerpt is dropped, and so is a step left with
 * none, the second of two excerpts on the same lines, and every step past the seventh.
 */
export const keptSteps = (
  steps: readonly StepDraft[],
  problems: readonly StepProblem[],
): Step[] => {
  const badExcerpt = (step: number, excerpt: number) =>
    problems.some(
      (problem) =>
        (problem.kind === "unknown-hunk" ||
          problem.kind === "mechanical" ||
          problem.kind === "lines-outside") &&
        problem.step === step &&
        problem.excerpt === excerpt,
    );
  const overlapping = (step: number) =>
    problems.some((problem) => problem.kind === "overlap" && problem.step === step);
  return steps
    .slice(0, MAX_STEPS)
    .flatMap((step, index) => {
      const excerpts = step.excerpts
        .filter((_, at) => !badExcerpt(index, at))
        .slice(0, overlapping(index) ? 1 : 2);
      return excerpts.length === 0 ? [] : [{ sentence: step.sentence, excerpts }];
    })
    .map((step, index) => ({ ...step, id: StepId.parse(`t${index + 1}`) }));
};
