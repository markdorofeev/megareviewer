import {
  type CallGraphHint,
  type CallSite,
  type HunkPart,
  type PartId,
  partId,
  partsByHunk,
  renameCallSites,
  renameHints,
  type UnchangedCallers,
} from "../diff/index.ts";
import type { Tour } from "./tour.ts";

export interface JoinedParts {
  readonly tour: Tour;
  /** The parts left, of the hunks still split. */
  readonly parts: readonly HunkPart[];
  readonly callGraph: readonly CallGraphHint[];
  readonly unchangedCallers: readonly UnchangedCallers[];
  readonly callSites: readonly CallSite[];
}

/**
 * Joins back what the tour placed together. Consecutive candidate parts of one hunk in the same
 * step become one part, which reads where the first of them did; a hunk whose candidates all
 * landed in one step is whole again, with its hunk ID. Parts left are numbered again from 1. The
 * tour's steps, `via` and entries, the hints, the unchanged callers and the call sites name the
 * joined parts.
 *
 * Splitting without joining gave 115 parts on a PR of 48 hunks, one file in 29 pieces: too fine to
 * read. A part is split off only where the tour reads it apart from its neighbors.
 */
export const joinParts = (
  tour: Tour,
  candidates: readonly HunkPart[],
  callGraph: readonly CallGraphHint[],
  unchangedCallers: readonly UnchangedCallers[] = [],
  callSites: readonly CallSite[] = [],
): JoinedParts => {
  const stepOf = new Map<PartId, number>();
  tour.steps.forEach((step, at) => {
    for (const id of step.partIds) if (!stepOf.has(id)) stepOf.set(id, at);
  });
  const rename = new Map<PartId, PartId>();
  const parts: HunkPart[] = [];
  for (const [hunkId, ofHunk] of partsByHunk(candidates)) {
    // Runs of consecutive parts in one step, each kept by its first part.
    const groups: { first: HunkPart; last: HunkPart; parts: HunkPart[] }[] = [];
    for (const part of ofHunk) {
      const group = groups.at(-1);
      if (group !== undefined && stepOf.get(group.first.id) === stepOf.get(part.id)) {
        group.parts.push(part);
        group.last = part;
      } else groups.push({ first: part, last: part, parts: [part] });
    }
    if (groups.length === 1) {
      for (const part of ofHunk) rename.set(part.id, hunkId);
      continue;
    }
    groups.forEach((group, at) => {
      const joined: HunkPart = {
        id: partId(hunkId, at + 1),
        hunkId,
        start: group.first.start,
        end: group.last.end,
        definitions: [...new Set(group.parts.flatMap((part) => part.definitions))],
      };
      parts.push(joined);
      for (const part of group.parts) rename.set(part.id, joined.id);
    });
  }
  const renamed = (id: PartId): PartId => rename.get(id) ?? id;
  const each = (ids: readonly PartId[]): PartId[] => [...new Set(ids.map(renamed))];
  return {
    tour: {
      ...tour,
      steps: tour.steps.map((step) => ({
        ...step,
        partIds: each(step.partIds),
        via: each(step.via),
        entries: each(step.entries),
      })),
    },
    parts,
    callGraph: renameHints(callGraph, renamed),
    unchangedCallers: unchangedCallers.map((callers) => ({
      ...callers,
      partId: renamed(callers.partId),
    })),
    callSites: renameCallSites(callSites, renamed),
  };
};
