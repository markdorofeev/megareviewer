import {
  type CallGraphHint,
  type CallSite,
  type DefinitionCalls,
  type HunkPart,
  type PartId,
  partId,
  partsByHunk,
  renameCallSites,
  renameDefinitionCalls,
  renameHints,
  type UnchangedCallers,
} from "../diff/index.ts";
import type { Flow } from "./flows.ts";

export interface JoinedParts {
  readonly flows: readonly Flow[];
  /** The parts left, of the hunks still split. */
  readonly parts: readonly HunkPart[];
  readonly callGraph: readonly CallGraphHint[];
  readonly unchangedCallers: readonly UnchangedCallers[];
  readonly callSites: readonly CallSite[];
  readonly definitionCalls: readonly DefinitionCalls[];
}

/**
 * Joins consecutive candidate parts of a hunk that the flows put in one flow, and makes a hunk whole
 * again when all of its parts did. Parts left are renumbered, and everything naming them remapped.
 */
export const joinParts = (
  flows: readonly Flow[],
  candidates: readonly HunkPart[],
  callGraph: readonly CallGraphHint[],
  unchangedCallers: readonly UnchangedCallers[] = [],
  callSites: readonly CallSite[] = [],
  definitionCalls: readonly DefinitionCalls[] = [],
): JoinedParts => {
  const flowOf = new Map<PartId, number>();
  flows.forEach((flow, at) => {
    for (const id of flow.partIds) if (!flowOf.has(id)) flowOf.set(id, at);
  });
  const rename = new Map<PartId, PartId>();
  const parts: HunkPart[] = [];
  for (const [hunkId, ofHunk] of partsByHunk(candidates)) {
    // Runs of consecutive parts in one flow, each kept by its first part.
    const groups: { first: HunkPart; last: HunkPart; parts: HunkPart[] }[] = [];
    for (const part of ofHunk) {
      const group = groups.at(-1);
      if (group !== undefined && flowOf.get(group.first.id) === flowOf.get(part.id)) {
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
    flows: flows.map((flow) => ({
      ...flow,
      partIds: each(flow.partIds),
      entries: each(flow.entries),
    })),
    parts,
    callGraph: renameHints(callGraph, renamed),
    unchangedCallers: unchangedCallers.map((callers) => ({
      ...callers,
      partId: renamed(callers.partId),
    })),
    callSites: renameCallSites(callSites, renamed),
    definitionCalls: renameDefinitionCalls(definitionCalls, renamed),
  };
};
