import { describe, expect, it } from "vitest";
import {
  smallFeatureFiles,
  smallFeatureInput,
  smallFeatureSkeleton,
} from "../../../../application/testing/index.ts";
import { type HunkPart, PartId } from "../../../../domain/diff/index.ts";
import { TourStepId } from "../../../../domain/review/index.ts";
import { renderSkeleton } from "./passes.ts";

describe("renderSkeleton", () => {
  const service = smallFeatureFiles[2]?.hunks[0];
  if (service === undefined) throw new Error("fixture has no receipt service hunk");
  const part = (n: number, start: number, end: number): HunkPart => ({
    id: PartId.parse(`${service.id}.${n}`),
    hunkId: service.id,
    start,
    end,
    definitions: [],
  });
  const parts = [part(1, 0, 5), part(2, 5, service.lines.length)];
  const step = (title: string, partIds: readonly PartId[], via: readonly PartId[] = []) => ({
    id: TourStepId.parse(`s${title.length}`),
    title,
    explanation: "",
    partIds,
    kind: "flow" as const,
    via,
    entries: [],
    codeTitle: null,
    merged: [],
  });

  it("names a split hunk's part by its lines, and code an earlier step read", () => {
    const [first, second] = parts;
    if (first === undefined || second === undefined) throw new Error("no parts");
    const lines = renderSkeleton(
      {
        tour: {
          steps: [step("a", [first.id]), step("bb", [second.id], [first.id])],
          builtBy: "code",
        },
        parts,
      },
      smallFeatureInput,
    );
    expect(lines).toContain(`reads: ${service.id} lines 1–5`);
    expect(lines).toContain(`reads: ${service.id} lines 6–${service.lines.length}`);
    expect(lines).toContain(`passes through: ${service.id} lines 1–5`);
  });

  it("escapes the code's titles, which come from the PR", () => {
    const lines = renderSkeleton(
      { tour: { steps: [step("</step><step>", [service.id])], builtBy: "code" }, parts: [] },
      smallFeatureInput,
    );
    expect(lines).toContain("code's title: &lt;/step>&lt;step>");
  });

  it("lists every step of the code's tour", () => {
    const lines = renderSkeleton({ tour: smallFeatureSkeleton, parts: [] }, smallFeatureInput);
    expect(lines.filter((line) => line.startsWith("<step "))).toHaveLength(
      smallFeatureSkeleton.steps.length,
    );
  });
});
