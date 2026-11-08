import { describe, expect, it } from "vitest";
import { HunkId, type PartId } from "../diff/index.ts";
import { type Tour, type TourStep, TourStepId } from "./tour.ts";
import { applyTourTitles, MAX_EXPLANATION, MAX_TITLE, type TourTitles } from "./tour-titles.ts";
import { validateTourTitles } from "./validation.ts";

const h = (n: number): PartId => HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`);

const step = (n: number, kind: TourStep["kind"], partIds: PartId[], via: PartId[] = []) => ({
  id: TourStepId.parse(`s${n}`),
  title: kind === "flow" ? `GET /items/${n}` : n === 3 ? "Docs" : "Tests",
  explanation: "The code's explanation.",
  partIds,
  kind,
  via,
  entries: kind === "flow" ? partIds.slice(0, 1) : [],
  codeTitle: null,
  merged: [],
});

// Two flows, then docs and tests.
const skeleton: Tour = {
  steps: [
    step(1, "flow", [h(1), h(2)]),
    step(2, "flow", [h(3)], [h(2)]),
    step(3, "supporting", [h(4)]),
    step(4, "supporting", [h(5)]),
  ],
  builtBy: "code",
};

const titled = (merges: TourTitles["merges"] = []): TourTitles => ({
  steps: skeleton.steps.map((one) => ({
    stepId: one.id,
    title: `Title of ${one.id}`,
    explanation: `Explanation of ${one.id}.`,
  })),
  merges,
});

describe("validateTourTitles", () => {
  it("accepts a title for every step and merges of supporting steps", () => {
    expect(validateTourTitles(titled(), skeleton)).toEqual([]);
    expect(
      validateTourTitles(
        titled([
          { stepId: "s3", intoStepId: "s1", reason: "Documents the route." },
          { stepId: "s4", intoStepId: "s2", reason: "Tests the second route." },
        ]),
        skeleton,
      ),
    ).toEqual([]);
  });

  it("reports a missing title, a repeated one and one for an unknown step", () => {
    const [first, second] = titled().steps;
    if (first === undefined || second === undefined) throw new Error("no steps");
    expect(
      validateTourTitles(
        {
          steps: [first, first, { ...second, stepId: "s9" }, { ...second, stepId: "s9" }],
          merges: [],
        },
        skeleton,
      ),
    ).toEqual([
      { kind: "duplicate", stepId: "s1" },
      { kind: "unknown", stepId: "s9" },
      { kind: "missing", stepId: "s2" },
      { kind: "missing", stepId: "s3" },
      { kind: "missing", stepId: "s4" },
    ]);
  });

  it("reports blank and overlong titles and explanations", () => {
    const steps = titled().steps.map((one, at) =>
      at === 0
        ? { ...one, title: "x".repeat(MAX_TITLE + 1), explanation: "  " }
        : at === 1
          ? { ...one, title: " ", explanation: "y".repeat(MAX_EXPLANATION + 1) }
          : one,
    );
    expect(validateTourTitles({ steps, merges: [] }, skeleton)).toEqual([
      { kind: "too-long", stepId: "s1", field: "title" },
      { kind: "blank", stepId: "s1", field: "explanation" },
      { kind: "blank", stepId: "s2", field: "title" },
      { kind: "too-long", stepId: "s2", field: "explanation" },
    ]);
  });

  it("accepts a title of exactly the longest length, counted without surrounding spaces", () => {
    const steps = titled().steps.map((one) => ({ ...one, title: ` ${"x".repeat(MAX_TITLE)} ` }));
    expect(validateTourTitles({ steps, merges: [] }, skeleton)).toEqual([]);
  });

  it("reports merges of a flow or an unknown step, into an unknown or merged step, twice or without a reason", () => {
    expect(
      validateTourTitles(
        titled([
          { stepId: "s1", intoStepId: "s2", reason: "A flow." },
          { stepId: "s9", intoStepId: "s1", reason: "Unknown." },
          { stepId: "s3", intoStepId: "s7", reason: "Into nothing." },
          { stepId: "s3", intoStepId: "s1", reason: "Again." },
          { stepId: "s4", intoStepId: "s4", reason: " " },
        ]),
        skeleton,
      ),
    ).toEqual([
      { kind: "merge-of-flow", stepId: "s1" },
      { kind: "merge-unknown", stepId: "s9" },
      { kind: "merge-into-merged", stepId: "s9", intoStepId: "s1" },
      { kind: "merge-into-unknown", stepId: "s3", intoStepId: "s7" },
      { kind: "merged-twice", stepId: "s3" },
      { kind: "merge-into-merged", stepId: "s4", intoStepId: "s4" },
      { kind: "merge-no-reason", stepId: "s4" },
    ]);
  });
});

describe("applyTourTitles", () => {
  it("keeps the code's steps and its titles under the model's", () => {
    const tour = applyTourTitles(skeleton, titled());
    expect(tour.builtBy).toBe("model");
    expect(
      tour.steps.map(({ id, title, codeTitle, partIds }) => ({ id, title, codeTitle, partIds })),
    ).toEqual([
      { id: "s1", title: "Title of s1", codeTitle: "GET /items/1", partIds: [h(1), h(2)] },
      { id: "s2", title: "Title of s2", codeTitle: "GET /items/2", partIds: [h(3)] },
      { id: "s3", title: "Title of s3", codeTitle: "Docs", partIds: [h(4)] },
      { id: "s4", title: "Title of s4", codeTitle: "Tests", partIds: [h(5)] },
    ]);
    expect(tour.steps[1]).toMatchObject({ kind: "flow", via: [h(2)], entries: [h(3)] });
  });

  it("trims what the model wrote", () => {
    const steps = titled().steps.map((one) => ({
      ...one,
      title: ` ${one.title} `,
      explanation: `${one.explanation}\n`,
    }));
    const [first] = applyTourTitles(skeleton, { steps, merges: [] }).steps;
    expect(first).toMatchObject({ title: "Title of s1", explanation: "Explanation of s1." });
  });

  it("reads a merged step at the end of the one it joins, with the reason, and numbers the rest", () => {
    const tour = applyTourTitles(
      skeleton,
      titled([
        { stepId: "s4", intoStepId: "s2", reason: " Tests the second route. " },
        { stepId: "s3", intoStepId: "s2", reason: "Documents it." },
      ]),
    );
    expect(tour.steps.map(({ id, partIds, merged }) => ({ id, partIds, merged }))).toEqual([
      { id: "s1", partIds: [h(1), h(2)], merged: [] },
      {
        id: "s2",
        partIds: [h(3), h(5), h(4)],
        merged: [
          { title: "Tests", reason: "Tests the second route." },
          { title: "Docs", reason: "Documents it." },
        ],
      },
    ]);
  });
});
