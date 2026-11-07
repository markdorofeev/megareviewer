import {
  buildCallGraphHints,
  type CallGraphHint,
  changedDefinitionNames,
  type FileSymbols,
  findFormattingProofs,
  findMechanicalProofs,
  type HunkId,
  lockfileWarnings,
  type MechanicalProof,
} from "../../domain/diff/index.ts";
import type { CodeParser, Token } from "../ports/index.ts";
import type { Collected } from "./collect.ts";

export interface Prepared {
  /** At most one per hunk. */
  readonly proofs: readonly MechanicalProof[];
  readonly callGraph: readonly CallGraphHint[];
  /** Each hunk's changed definitions, for the tour's entry points. Not stored. */
  readonly definitions: ReadonlyMap<HunkId, readonly string[]>;
  readonly warnings: readonly string[];
  /** Hunks without a proof: the ones the model passes must cover. */
  readonly required: ReadonlySet<HunkId>;
}

/** The deterministic step: mechanical proofs and call-graph hints, no model. */
export const prep = async (parser: CodeParser, collected: Collected): Promise<Prepared> => {
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
  for (const file of files) {
    const head = headContents.get(file.path);
    if (file.language === null || head == null) continue;
    const symbols = await parser.symbols(head, file.language);
    if (symbols.ok) symbolsByPath.set(file.path, symbols.value);
  }

  const provedHunks = new Set(proofs.flatMap((proof) => proof.hunkId ?? []));
  return {
    proofs,
    callGraph: buildCallGraphHints(files, symbolsByPath),
    definitions: changedDefinitionNames(files, symbolsByPath),
    warnings: lockfileWarnings(files),
    required: new Set(
      files
        .flatMap((file) => file.hunks.map((hunk) => hunk.id))
        .filter((id) => !provedHunks.has(id)),
    ),
  };
};
