import { isTestFile, type PartId } from "../../../../src/domain/diff/index.ts";
import type {
  Analysis,
  DecisionId,
  TourStep,
  TourStepId,
} from "../../../../src/domain/review/index.ts";
import { hunkLocation } from "../../diff/index.ts";
import { CATEGORY_NAMES } from "./DecisionCard.tsx";
import type { PartIndex } from "./model.ts";

export type PaletteGroup =
  | "decisions"
  | "mismatches"
  | "contract"
  | "unchanged"
  | "routes"
  | "symbols"
  | "steps"
  | "files";

export const PALETTE_GROUPS: readonly { readonly group: PaletteGroup; readonly title: string }[] = [
  { group: "decisions", title: "Decisions" },
  { group: "mismatches", title: "Mismatches" },
  { group: "contract", title: "Contract changes" },
  { group: "unchanged", title: "Used unchanged" },
  { group: "routes", title: "Routes" },
  { group: "symbols", title: "Symbols" },
  { group: "steps", title: "Steps" },
  { group: "files", title: "Files" },
];

/** Where opening an item goes. */
export type PaletteTarget =
  | { readonly kind: "decision"; readonly decisionId: DecisionId }
  | { readonly kind: "mismatch"; readonly index: number }
  | { readonly kind: "hunk"; readonly partId: PartId }
  | { readonly kind: "step"; readonly stepId: TourStepId }
  | { readonly kind: "mechanical" };

export interface PaletteItem {
  readonly key: string;
  readonly group: PaletteGroup;
  readonly label: string;
  readonly detail: string;
  readonly target: PaletteTarget;
}

/** A prefix limits the search to these groups. */
const PREFIXES: Readonly<Record<string, readonly PaletteGroup[]>> = {
  "!": ["decisions", "mismatches", "contract"],
  "@": ["symbols"],
  "/": ["files"],
};

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** Items each group shows at most. */
const MAX_PER_GROUP = 8;

/** Everything the palette can jump to, by group. */
export const paletteItems = (
  analysis: Analysis,
  steps: readonly TourStep[],
  index: PartIndex,
): PaletteItem[] => {
  const where = (id: PartId): string => {
    const found = index.parts.get(id);
    return found === undefined ? "" : `${found.file.path}, ${hunkLocation(found.hunk)}`;
  };
  // Routes the pull request requests, each with the files that request it.
  const requesters = new Map<
    string,
    { readonly route: PartId; readonly symbol: string; readonly files: Set<string> }
  >();
  for (const hint of analysis.callGraph) {
    const from = index.parts.get(hint.fromPartId);
    if (hint.use !== "request" || from === undefined || !index.parts.has(hint.toPartId)) continue;
    const key = `route:${hint.symbol}:${hint.toPartId}`;
    const known = requesters.get(key) ?? {
      route: hint.toPartId,
      symbol: hint.symbol,
      files: new Set<string>(),
    };
    known.files.add(from.file.path);
    requesters.set(key, known);
  }
  const routes = [...requesters].map(
    ([key, { route, symbol, files }]): PaletteItem => ({
      key,
      group: "routes",
      label: symbol,
      detail: `${basename(index.parts.get(route)?.file.path ?? "")}, requested in ${[...files]
        .sort((a, b) => Number(isTestFile(a)) - Number(isTestFile(b)))
        .map(basename)
        .join(", ")}`,
      target: { kind: "hunk", partId: route },
    }),
  );
  const symbols = new Map<string, PaletteItem>();
  for (const hint of analysis.callGraph) {
    if (hint.use === "request") continue;
    const key = `symbol:${hint.symbol}:${hint.toPartId}`;
    if (symbols.has(key) || !index.parts.has(hint.toPartId)) continue;
    symbols.set(key, {
      key,
      group: "symbols",
      label: hint.symbol,
      detail: where(hint.toPartId),
      target: { kind: "hunk", partId: hint.toPartId },
    });
  }
  return [
    ...analysis.decisions.map(
      (decision): PaletteItem => ({
        key: `decision:${decision.id}`,
        group: "decisions",
        label: decision.title,
        detail: CATEGORY_NAMES[decision.category],
        target: { kind: "decision", decisionId: decision.id },
      }),
    ),
    ...(analysis.intent?.mismatches ?? []).map(
      (mismatch, at): PaletteItem => ({
        key: `mismatch:${at}`,
        group: "mismatches",
        label: mismatch.description,
        detail: mismatch.kind,
        target: { kind: "mismatch", index: at },
      }),
    ),
    ...analysis.risk.flatMap((risk): PaletteItem[] => {
      // A split hunk's contract change goes to its first part.
      const [first] = risk.riskClass === "contract" ? index.partsOf(risk.hunkId) : [];
      return first === undefined
        ? []
        : [
            {
              key: `contract:${risk.hunkId}`,
              group: "contract",
              label: risk.reason,
              detail: where(first),
              target: { kind: "hunk", partId: first },
            },
          ];
    }),
    ...analysis.unchangedCallers.flatMap(({ partId, symbol, uses, more }): PaletteItem[] => {
      const found = index.parts.get(partId);
      if (found === undefined) return [];
      const files = [...new Set(uses.map((use) => use.path))];
      const count = uses.length + more;
      return [
        {
          key: `unchanged:${symbol}:${partId}`,
          group: "unchanged",
          label: symbol,
          detail: `${basename(found.file.path)}, used unchanged in ${count === 1 ? "1 place" : `${count} places`}: ${files
            .sort((a, b) => Number(isTestFile(a)) - Number(isTestFile(b)))
            .map(basename)
            .join(", ")}`,
          target: { kind: "hunk", partId },
        },
      ];
    }),
    ...routes,
    ...symbols.values(),
    ...steps.map(
      (step, at): PaletteItem => ({
        key: `step:${step.id}`,
        group: "steps",
        label: step.title,
        detail: step.codeTitle === null ? `Step ${at + 1}` : `Step ${at + 1} · ${step.codeTitle}`,
        target: { kind: "step", stepId: step.id },
      }),
    ),
    ...[...analysis.files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file): PaletteItem => {
        const hunk = file.hunks.find((one) => !index.mechanical.has(one.id)) ?? file.hunks[0];
        const first = hunk === undefined ? undefined : index.partsOf(hunk.id)[0];
        return {
          key: `file:${file.path}`,
          group: "files",
          label: file.path,
          detail: file.status,
          // A file with no hunks, like a pure rename, shows with the mechanical changes.
          target: first === undefined ? { kind: "mechanical" } : { kind: "hunk", partId: first },
        };
      }),
  ];
};

/**
 * The items whose label or detail contains every typed word, by group, each group cut to its
 * first few. A leading `!`, `@` or `/` limits the search to its groups.
 */
export const searchPalette = (
  items: readonly PaletteItem[],
  query: string,
): { readonly group: PaletteGroup; readonly title: string; readonly items: PaletteItem[] }[] => {
  const trimmed = query.trimStart();
  const only = PREFIXES[trimmed.charAt(0)];
  const words = (only === undefined ? trimmed : trimmed.slice(1))
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return PALETTE_GROUPS.filter(({ group }) => only === undefined || only.includes(group))
    .map(({ group, title }) => ({
      group,
      title,
      items: items
        .filter((item) => item.group === group)
        .filter((item) => {
          const text = `${item.label} ${item.detail}`.toLowerCase();
          return words.every((word) => text.includes(word));
        })
        .slice(0, MAX_PER_GROUP),
    }))
    .filter(({ items: found }) => found.length > 0);
};
