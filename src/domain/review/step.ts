import { z } from "zod";
import {
  type CallGraphHint,
  type Hunk,
  type HunkId,
  type HunkPart,
  hunkHasLine,
  type PartId,
} from "../diff/index.ts";
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
 * A place on the page's tour: one sentence of what happens there, and the lines of one or two
 * hunks that decide it. Two only when the hop crosses into another process, such as a client call
 * and its route.
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
  | { readonly kind: "same-file"; readonly step: number }
  /** `step` comes before `caller`, whose code calls it: callers come first. */
  | { readonly kind: "order"; readonly step: number; readonly caller: number }
  | { readonly kind: "too-many"; readonly step: number };

export interface StepContext {
  readonly hunks: ReadonlyMap<HunkId, Hunk>;
  /** Hunks with a mechanical proof, which the model was sent as stats only. */
  readonly mechanical: ReadonlySet<HunkId>;
  readonly parts: readonly HunkPart[];
  readonly callGraph: readonly CallGraphHint[];
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

/** The parts whose lines an excerpt shows: a hunk that isn't split is one part. */
const partsOfExcerpt = (excerpt: PointLines, context: StepContext): PartId[] => {
  const hunk = context.hunks.get(excerpt.hunkId);
  if (hunk === undefined) return [];
  const own = context.parts.filter((part) => part.hunkId === excerpt.hunkId);
  if (own.length === 0) return [excerpt.hunkId];
  const shown = hunk.lines.flatMap((line, index) => {
    const number = excerpt.side === "new" ? line.newLine : line.oldLine;
    return number !== null && number >= excerpt.startLine && number <= excerpt.line ? [index] : [];
  });
  return own
    .filter((part) => shown.some((index) => index >= part.start && index < part.end))
    .map((part) => part.id);
};

/**
 * Pairs of steps out of call order: an earlier step whose code a later step's calls, by the call
 * graph's direct hints between their parts. Steps that call each other either way are left alone.
 */
const orderProblems = (
  steps: readonly StepDraft[],
  context: StepContext,
): { step: number; caller: number }[] => {
  const partsOf = steps.map(
    (step) => new Set(step.excerpts.flatMap((excerpt) => partsOfExcerpt(excerpt, context))),
  );
  const calls = (from: number, to: number) =>
    context.callGraph.some(
      (hint) =>
        hint.use !== "type" &&
        hint.fromPartId !== hint.toPartId &&
        partsOf[from]?.has(hint.fromPartId) === true &&
        partsOf[to]?.has(hint.toPartId) === true,
    );
  const problems: { step: number; caller: number }[] = [];
  for (let step = 0; step < steps.length; step += 1) {
    for (let caller = step + 1; caller < steps.length; caller += 1) {
      if (calls(caller, step) && !calls(step, caller)) problems.push({ step, caller });
    }
  }
  return problems;
};

/**
 * Every problem with the model's steps: excerpts on hunks it wasn't sent in full or on lines
 * their hunk doesn't show, two excerpts in one file, steps out of call order, and steps past
 * the seventh.
 */
export const validateSteps = (steps: readonly StepDraft[], context: StepContext): StepProblem[] => [
  ...steps.flatMap((step, index): StepProblem[] => {
    const excerpts = step.excerpts.flatMap((excerpt, at): StepProblem[] => {
      const kind = excerptProblem(excerpt, context);
      return kind === null ? [] : [{ kind, step: index, excerpt: at, hunkId: excerpt.hunkId }];
    });
    const paths = step.excerpts.map((excerpt) => context.hunks.get(excerpt.hunkId)?.path);
    const sameFile =
      paths.length === 2 && paths[0] !== undefined && paths[0] === paths[1]
        ? [{ kind: "same-file" as const, step: index }]
        : [];
    return [...excerpts, ...sameFile];
  }),
  ...orderProblems(steps, context).map(({ step, caller }) => ({
    kind: "order" as const,
    step,
    caller,
  })),
  ...steps.slice(MAX_STEPS).map((_, at) => ({ kind: "too-many" as const, step: MAX_STEPS + at })),
];

/**
 * The steps kept after the retry, numbered: a bad excerpt is dropped, and so is a step left with
 * none, the second excerpt of two in one file, and every step past the seventh. An order still
 * wrong is kept, since the code is all there; the caller logs it.
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
  const sameFile = (step: number) =>
    problems.some((problem) => problem.kind === "same-file" && problem.step === step);
  return steps
    .slice(0, MAX_STEPS)
    .flatMap((step, index) => {
      const excerpts = step.excerpts
        .filter((_, at) => !badExcerpt(index, at))
        .slice(0, sameFile(index) ? 1 : 2);
      return excerpts.length === 0 ? [] : [{ sentence: step.sentence, excerpts }];
    })
    .map((step, index) => ({ ...step, id: StepId.parse(`t${index + 1}`) }));
};
