import type { CallSite, PartId } from "../../../../src/domain/diff/index.ts";
import type { Point } from "../../../../src/domain/review/index.ts";
import {
  type CallPayload,
  type CallPeekHandle,
  CallTrigger,
  type LineMark,
} from "../../review/index.ts";
import type { PartIndex } from "./model.ts";

/** Each part's calls, by new-side line, as marks that open the card of the code they run. */
export type CallMarks = ReadonlyMap<PartId, ReadonlyMap<number, readonly LineMark[]>>;

/** The id of a call's trigger, for the keyboard to open its card. */
export const callTriggerId = (site: Pick<CallSite, "partId" | "line" | "column">): string =>
  `call-${site.partId}-${site.line}-${site.column}`;

/**
 * Marks for the calls on the page: a call whose parts the page shows wraps its name in a trigger
 * that carries them. Calls into parts the page doesn't know mark nothing.
 */
export const callMarks = (
  sites: readonly CallSite[],
  index: PartIndex,
  handle: CallPeekHandle,
): CallMarks => {
  const byPart = new Map<PartId, Map<number, LineMark[]>>();
  for (const site of sites) {
    const targets = index.items(site.toPartIds).map(({ id, hunk, file }) => ({ id, hunk, file }));
    if (targets.length === 0 || !index.parts.has(site.partId)) continue;
    const payload = { symbol: site.symbol, targets };
    const id = callTriggerId(site);
    const lines = byPart.get(site.partId) ?? new Map<number, LineMark[]>();
    const marks = lines.get(site.line) ?? [];
    if (marks.some((mark) => mark.start === site.column)) continue;
    marks.push({
      start: site.column,
      end: site.column + site.length,
      render: (code) => (
        <CallTrigger handle={handle} payload={payload} id={id}>
          {code}
        </CallTrigger>
      ),
    });
    lines.set(site.line, marks);
    byPart.set(site.partId, lines);
  }
  return byPart;
};

/**
 * What a risk's checking test opens: the part of its hunk that shows its lines, or the hunk's
 * parts when none does, named by the test. Null when the page doesn't know the hunk.
 */
export const checkingTestPayload = (point: Point, index: PartIndex): CallPayload | null => {
  const checked = point.checkedBy;
  if (checked === undefined) return null;
  const { hunkId, startLine } = checked.lines;
  const parts = index.items(index.partsOf(hunkId));
  const showing = parts.filter(({ hunk }) =>
    hunk.lines.some((line) => line.kind !== "del" && line.newLine === startLine),
  );
  const targets = (showing.length > 0 ? showing : parts).map(({ id, hunk, file }) => ({
    id,
    hunk,
    file,
  }));
  return targets.length === 0
    ? null
    : { symbol: checked.test, targets, label: `Test ${checked.test}` };
};
