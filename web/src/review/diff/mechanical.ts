import type { FileChange, Hunk, MechanicalProof } from "../../../../src/domain/diff/index.ts";
import { lineCounts } from "./lines.ts";

/** One collapsed row: a mechanical hunk, or a file-level proof such as a pure rename. */
export interface MechanicalRow {
  readonly key: string;
  readonly path: string;
  readonly file: FileChange | null;
  /** null for a file-level proof: there's nothing to expand. */
  readonly hunk: Hunk | null;
  readonly proofs: readonly MechanicalProof[];
  readonly summary: string;
}

/**
 * Rows in file and hunk order. A proof whose file or hunk isn't among `files` still gets a row,
 * with its detail and nothing to expand, so no proof goes unshown.
 */
export const mechanicalRows = (
  files: readonly FileChange[],
  proofs: readonly MechanicalProof[],
): MechanicalRow[] => {
  const used = new Set<MechanicalProof>();
  const take = (matches: (proof: MechanicalProof) => boolean): MechanicalProof[] => {
    const taken = proofs.filter((proof) => !used.has(proof) && matches(proof));
    for (const proof of taken) used.add(proof);
    return taken;
  };

  const rows = files.flatMap((file): MechanicalRow[] => {
    const fileProofs = take((proof) => proof.path === file.path && proof.hunkId === null);
    const fileRows = fileProofs.map((proof) => ({
      key: `${file.path}\0${proof.kind}`,
      path: file.path,
      file,
      hunk: null,
      proofs: [proof],
      summary: fileProofSummary(proof, file),
    }));
    const hunkRows = file.hunks.flatMap((hunk): MechanicalRow[] => {
      const hunkProofs = take((proof) => proof.hunkId === hunk.id);
      if (hunkProofs.length === 0) return [];
      const { added, deleted } = lineCounts(hunk);
      const details = hunkProofs.map((proof) => proof.detail).join("; ");
      return [
        {
          key: hunk.id,
          path: file.path,
          file,
          hunk,
          proofs: hunkProofs,
          summary: `${file.path} — ${details} (+${added} −${deleted})`,
        },
      ];
    });
    return [...fileRows, ...hunkRows];
  });

  const orphans = proofs
    .filter((proof) => !used.has(proof))
    .map((proof, i) => ({
      key: `orphan-${i}`,
      path: proof.path,
      file: null,
      hunk: null,
      proofs: [proof],
      summary: `${proof.path} — ${proof.detail}`,
    }));
  return [...rows, ...orphans];
};

const fileProofSummary = (proof: MechanicalProof, file: FileChange): string =>
  proof.kind === "rename" && file.oldPath !== null
    ? `${file.oldPath} → ${file.path} — renamed, content unchanged`
    : `${file.path} — ${proof.detail}`;
