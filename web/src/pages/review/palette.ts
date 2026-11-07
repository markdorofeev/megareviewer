import type { PartId } from "../../../../src/domain/diff/index.ts";
import type {
  Analysis,
  DecisionId,
  TourStep,
  TourStepId,
} from "../../../../src/domain/review/index.ts";
import { hunkLocation } from "../../diff/index.ts";
import { CATEGORY_NAMES } from "./DecisionCard.tsx";
import type { HunkIndex } from "./model.ts";

export type PaletteGroup = "decisions" | "mismatches" | "contract" | "symbols" | "steps" | "files";

export const PALETTE_GROUPS: readonly { readonly group: PaletteGroup; readonly title: string }[] = [
  { group: "decisions", title: "Decisions" },
  { group: "mismatches", title: "Mismatches" },
  { group: "contract", title: "Contract changes" },
  { group: "symbols", title: "Symbols" },
  { group: "steps", title: "Steps" },
  { group: "files", title: "Files" },
];

/** Where opening an item goes. */
export type PaletteTarget =
  | { readonly kind: "decision"; readonly decisionId: DecisionId }
  | { readonly kind: "mismatch"; readonly index: number }
  | { readonly kind: "hunk"; readonly hunkId: PartId }
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

/** Items each group shows at most. */
const MAX_PER_GROUP = 8;

/** Everything the palette can jump to, by group. */
export const paletteItems = (
  analysis: Analysis,
  steps: readonly TourStep[],
  index: HunkIndex,
): PaletteItem[] => {
  const where = (id: PartId): string => {
    const found = index.hunks.get(id);
    return found === undefined ? "" : `${found.file.path}, ${hunkLocation(found.hunk)}`;
  };
  const symbols = new Map<string, PaletteItem>();
  for (const hint of analysis.callGraph) {
    const key = `symbol:${hint.symbol}:${hint.toPartId}`;
    if (symbols.has(key) || !index.hunks.has(hint.toPartId)) continue;
    symbols.set(key, {
      key,
      group: "symbols",
      label: hint.symbol,
      detail: where(hint.toPartId),
      target: { kind: "hunk", hunkId: hint.toPartId },
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
    ...analysis.risk.flatMap((risk): PaletteItem[] =>
      risk.riskClass === "contract" && index.hunks.has(risk.hunkId)
        ? [
            {
              key: `contract:${risk.hunkId}`,
              group: "contract",
              label: risk.reason,
              detail: where(risk.hunkId),
              target: { kind: "hunk", hunkId: risk.hunkId },
            },
          ]
        : [],
    ),
    ...symbols.values(),
    ...steps.map(
      (step, at): PaletteItem => ({
        key: `step:${step.id}`,
        group: "steps",
        label: step.title,
        detail: `Step ${at + 1}`,
        target: { kind: "step", stepId: step.id },
      }),
    ),
    ...[...analysis.files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file): PaletteItem => {
        const first = file.hunks.find((hunk) => !index.mechanical.has(hunk.id)) ?? file.hunks[0];
        return {
          key: `file:${file.path}`,
          group: "files",
          label: file.path,
          detail: file.status,
          // A file with no hunks, like a pure rename, shows with the mechanical changes.
          target: first === undefined ? { kind: "mechanical" } : { kind: "hunk", hunkId: first.id },
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
