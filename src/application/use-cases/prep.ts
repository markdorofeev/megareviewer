import {
  buildCallGraphHints,
  type CallGraphHint,
  changedDefinitionNames,
  changedDefinitions,
  type FileDefinitions,
  type FileLink,
  type FileSymbols,
  fileLinks,
  findFormattingProofs,
  findMechanicalProofs,
  type HunkId,
  type HunkPart,
  lockfileWarnings,
  type MechanicalProof,
  type PartId,
  splitHunks,
  type UnchangedCallers,
} from "../../domain/diff/index.ts";
import { looksGenerated } from "../../domain/review/index.ts";
import type { CodeParser, Token } from "../ports/index.ts";
import type { Collected } from "./collect.ts";
import { type CheckoutAt, readUnchangedCallers } from "./unchanged-callers.ts";

export interface Prepared {
  /** At most one per hunk. */
  readonly proofs: readonly MechanicalProof[];
  /**
   * Every hunk's candidate parts, one per definition it changes, for the tour to place. The tour
   * joins back the ones it places together.
   */
  readonly parts: readonly HunkPart[];
  /** Hints between parts: the candidates, or a hunk that isn't split. */
  readonly callGraph: readonly CallGraphHint[];
  readonly fileLinks: readonly FileLink[];
  /** Each part's changed definitions, for the tour's entry points. Not stored. */
  readonly definitions: ReadonlyMap<PartId, readonly string[]>;
  /** Paths whose first lines say a tool wrote them, for the tour's grouping and the overview. */
  readonly generated: ReadonlySet<string>;
  /** Read from the checkout, naming candidate parts like the hints; none without a checkout. */
  readonly unchangedCallers: readonly UnchangedCallers[];
  readonly warnings: readonly string[];
  /** Hunks without a proof: the ones the model passes must cover. */
  readonly required: ReadonlySet<HunkId>;
}

/**
 * The deterministic step: mechanical proofs, parts and call-graph hints, no model. With a checkout,
 * also the callers outside the PR of the definitions it changes.
 */
export const prep = async (
  parser: CodeParser,
  collected: Collected,
  checkout: CheckoutAt | null = null,
): Promise<Prepared> => {
  const { files, baseContents, headContents } = collected;
  const diffProofs = findMechanicalProofs(files, {
    gitattributes: collected.gitattributes,
    baseContents,
    headContents,
  });
  const proved = new Set(diffProofs.flatMap((proof) => proof.hunkId ?? []));

  const nodesByPath = new Map<string, { base: Token[]; head: Token[] }>();
  for (const file of files) {
    const base = baseContents.get(file.oldPath ?? file.path);
    const head = headContents.get(file.path);
    if (
      (file.status !== "modified" && file.status !== "renamed") ||
      file.language === null ||
      file.hunks.every((hunk) => proved.has(hunk.id)) ||
      base == null ||
      head == null
    ) {
      continue;
    }
    // A file that doesn't parse gets no proof: its hunks stay visible.
    const baseNodes = await parser.syntaxNodes(base, file.language);
    const headNodes = await parser.syntaxNodes(head, file.language);
    if (baseNodes.ok && headNodes.ok) {
      nodesByPath.set(file.path, { base: baseNodes.value, head: headNodes.value });
    }
  }
  // Diff proofs say more than "formatting only", so they win.
  const formattingProofs = findFormattingProofs(files, nodesByPath).filter(
    (proof) => proof.hunkId === null || !proved.has(proof.hunkId),
  );
  const proofs = [...diffProofs, ...formattingProofs];

  const symbolsByPath = new Map<string, FileSymbols>();
  const definitionsByPath = new Map<string, FileDefinitions>();
  for (const file of files) {
    if (file.language === null) continue;
    const head = headContents.get(file.path);
    const headSymbols = head == null ? null : await parser.symbols(head, file.language);
    if (headSymbols?.ok) symbolsByPath.set(file.path, headSymbols.value);
    // Deleted lines are cut by the definitions around them in the base file.
    const base = file.status === "added" ? null : baseContents.get(file.oldPath ?? file.path);
    const baseSymbols = base == null ? null : await parser.symbols(base, file.language);
    definitionsByPath.set(file.path, {
      head: headSymbols?.ok ? headSymbols.value.definitions : [],
      base: baseSymbols?.ok ? baseSymbols.value.definitions : [],
    });
  }

  const provedHunks = new Set(proofs.flatMap((proof) => proof.hunkId ?? []));
  // A proof is about a whole hunk, so a proved hunk is never split.
  const parts = splitHunks(files, definitionsByPath, provedHunks);
  const generated = new Set(
    files.flatMap((file) => (looksGenerated(headContents.get(file.path) ?? "") ? [file.path] : [])),
  );
  const outside =
    checkout === null
      ? { unchangedCallers: [], warnings: [] }
      : await readUnchangedCallers(
          parser,
          checkout,
          files,
          // Mechanical hunks don't change what a definition does.
          changedDefinitions(
            files.map((file) => ({
              ...file,
              hunks: file.hunks.filter((hunk) => !provedHunks.has(hunk.id)),
            })),
            definitionsByPath,
            parts,
          ),
          generated,
        );
  return {
    proofs,
    parts,
    callGraph: buildCallGraphHints(files, symbolsByPath, parts),
    fileLinks: fileLinks(files, symbolsByPath),
    definitions: changedDefinitionNames(files, symbolsByPath, parts),
    generated,
    unchangedCallers: outside.unchangedCallers,
    warnings: [...lockfileWarnings(files), ...outside.warnings],
    required: new Set(
      files
        .flatMap((file) => file.hunks.map((hunk) => hunk.id))
        .filter((id) => !provedHunks.has(id)),
    ),
  };
};
