import { z } from "zod";
import type { CallGraphHint, Hunk, HunkId, HunkPart, PartId } from "../diff/index.ts";
import { pointLinesFit } from "./point.ts";
import { PointLines } from "./point-lines.ts";

/** "t1", "t2", … in tour order. */
export const StopId = z
  .string()
  .regex(/^t[1-9][0-9]*$/)
  .brand<"StopId">();
export type StopId = z.infer<typeof StopId>;

/** Fewer stops than this aren't a tour: the change is told in its brief. */
export const MIN_STOPS = 3;
export const MAX_STOPS = 7;

/**
 * A place on the page's tour: one sentence of what happens there, and the lines of one or two
 * hunks that decide it. Two only when the hop crosses into another process, such as a client call
 * and its route.
 */
export const Stop = z
  .object({
    id: StopId,
    sentence: z.string().min(1),
    excerpts: z.array(PointLines).min(1).max(2).readonly(),
  })
  .readonly();
export type Stop = z.infer<typeof Stop>;

/** A stop as the model writes it; the server numbers them. */
export const StopDraft = Stop.unwrap().omit({ id: true }).readonly();
export type StopDraft = z.infer<typeof StopDraft>;

/** What can be wrong with the stops the model wrote, by stop and excerpt index. */
export type StopProblem =
  | {
      readonly kind: "unknown-hunk" | "mechanical" | "lines-outside";
      readonly stop: number;
      readonly excerpt: number;
      readonly hunkId: HunkId;
    }
  | { readonly kind: "same-file"; readonly stop: number }
  /** `stop` comes before `caller`, whose code calls it: callers come first. */
  | { readonly kind: "order"; readonly stop: number; readonly caller: number }
  | { readonly kind: "too-many"; readonly stop: number };

export interface StopContext {
  readonly hunks: ReadonlyMap<HunkId, Hunk>;
  /** Hunks with a mechanical proof, which the model was sent as stats only. */
  readonly mechanical: ReadonlySet<HunkId>;
  readonly parts: readonly HunkPart[];
  readonly callGraph: readonly CallGraphHint[];
}

const excerptProblem = (
  excerpt: PointLines,
  { hunks, mechanical }: StopContext,
): "unknown-hunk" | "mechanical" | "lines-outside" | null => {
  if (!hunks.has(excerpt.hunkId)) return "unknown-hunk";
  if (mechanical.has(excerpt.hunkId)) return "mechanical";
  return pointLinesFit([excerpt.hunkId], excerpt, hunks) ? null : "lines-outside";
};

/** The parts whose lines an excerpt shows: a hunk that isn't split is one part. */
const partsOfExcerpt = (excerpt: PointLines, context: StopContext): PartId[] => {
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
 * Pairs of stops out of call order: an earlier stop whose code a later stop's calls, by the call
 * graph's direct hints between their parts. Stops that call each other either way are left alone.
 */
const orderProblems = (
  stops: readonly StopDraft[],
  context: StopContext,
): { stop: number; caller: number }[] => {
  const partsOf = stops.map(
    (stop) => new Set(stop.excerpts.flatMap((excerpt) => partsOfExcerpt(excerpt, context))),
  );
  const calls = (from: number, to: number) =>
    context.callGraph.some(
      (hint) =>
        hint.use !== "type" &&
        hint.fromPartId !== hint.toPartId &&
        partsOf[from]?.has(hint.fromPartId) === true &&
        partsOf[to]?.has(hint.toPartId) === true,
    );
  const problems: { stop: number; caller: number }[] = [];
  for (let stop = 0; stop < stops.length; stop += 1) {
    for (let caller = stop + 1; caller < stops.length; caller += 1) {
      if (calls(caller, stop) && !calls(stop, caller)) problems.push({ stop, caller });
    }
  }
  return problems;
};

/**
 * Every problem with the model's stops: excerpts on hunks it wasn't sent in full or on lines
 * their hunk doesn't show, two excerpts in one file, stops out of call order, and stops past
 * the seventh.
 */
export const validateStops = (stops: readonly StopDraft[], context: StopContext): StopProblem[] => [
  ...stops.flatMap((stop, index): StopProblem[] => {
    const excerpts = stop.excerpts.flatMap((excerpt, at): StopProblem[] => {
      const kind = excerptProblem(excerpt, context);
      return kind === null ? [] : [{ kind, stop: index, excerpt: at, hunkId: excerpt.hunkId }];
    });
    const paths = stop.excerpts.map((excerpt) => context.hunks.get(excerpt.hunkId)?.path);
    const sameFile =
      paths.length === 2 && paths[0] !== undefined && paths[0] === paths[1]
        ? [{ kind: "same-file" as const, stop: index }]
        : [];
    return [...excerpts, ...sameFile];
  }),
  ...orderProblems(stops, context).map(({ stop, caller }) => ({
    kind: "order" as const,
    stop,
    caller,
  })),
  ...stops.slice(MAX_STOPS).map((_, at) => ({ kind: "too-many" as const, stop: MAX_STOPS + at })),
];

/**
 * The stops kept after the retry, numbered: a bad excerpt is dropped, and so is a stop left with
 * none, the second excerpt of two in one file, and every stop past the seventh. An order still
 * wrong is kept, since the code is all there; the caller logs it.
 */
export const keptStops = (
  stops: readonly StopDraft[],
  problems: readonly StopProblem[],
): Stop[] => {
  const badExcerpt = (stop: number, excerpt: number) =>
    problems.some(
      (problem) =>
        (problem.kind === "unknown-hunk" ||
          problem.kind === "mechanical" ||
          problem.kind === "lines-outside") &&
        problem.stop === stop &&
        problem.excerpt === excerpt,
    );
  const sameFile = (stop: number) =>
    problems.some((problem) => problem.kind === "same-file" && problem.stop === stop);
  return stops
    .slice(0, MAX_STOPS)
    .flatMap((stop, index) => {
      const excerpts = stop.excerpts
        .filter((_, at) => !badExcerpt(index, at))
        .slice(0, sameFile(index) ? 1 : 2);
      return excerpts.length === 0 ? [] : [{ sentence: stop.sentence, excerpts }];
    })
    .map((stop, index) => ({ ...stop, id: StopId.parse(`t${index + 1}`) }));
};
