import {
  type FileChange,
  type Hunk,
  hunkIdOf,
  type MechanicalProof,
  renameHints,
} from "../../domain/diff/index.ts";
import type { ModelError, PullRequest, Ticket } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { AnalysisInput, AnalysisInputFile, AnalysisModel } from "../ports/index.ts";
import { appError, type UseCaseError } from "./errors.ts";
import type { Prepared } from "./prep.ts";
import { count } from "./text.ts";

/**
 * What the model passes see: hunks without a proof in full, proved hunks as stats, and the head
 * content of files the model has to read.
 */
export const buildAnalysisInput = (input: {
  readonly pullRequest: PullRequest;
  readonly tickets: readonly Ticket[];
  readonly files: readonly FileChange[];
  readonly headContents: ReadonlyMap<string, string | null>;
  readonly prepared: Prepared;
}): AnalysisInput => {
  const { pullRequest, prepared } = input;
  const proofOf = new Map(
    prepared.proofs.flatMap((proof) => (proof.hunkId === null ? [] : [[proof.hunkId, proof]])),
  );
  const fileProved = new Set(
    prepared.proofs.flatMap((proof) => (proof.hunkId === null ? [proof.path] : [])),
  );
  return {
    pullRequest: {
      title: pullRequest.title,
      description: pullRequest.description,
      sourceBranch: pullRequest.sourceBranch,
      targetBranch: pullRequest.targetBranch,
      commits: pullRequest.commits,
      url: pullRequest.url,
    },
    tickets: input.tickets,
    files: input.files.map((file): AnalysisInputFile => {
      const hunks = file.hunks.filter((hunk) => !proofOf.has(hunk.id));
      const mechanicalHunks = file.hunks.flatMap((hunk) => {
        const proof = proofOf.get(hunk.id);
        return proof === undefined ? [] : [mechanicalHunk(hunk, proof)];
      });
      return {
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
        language: file.language,
        mechanical: fileProved.has(file.path) || (file.hunks.length > 0 && hunks.length === 0),
        hunks,
        mechanicalHunks,
        headContent: hunks.length > 0 ? (input.headContents.get(file.path) ?? null) : null,
      };
    }),
    // The model follows calls; type uses would only lengthen its prompt. It sees whole hunks.
    callGraph: renameHints(
      prepared.callGraph.filter((hint) => hint.use === "call"),
      hunkIdOf,
    ),
  };
};

const mechanicalHunk = (hunk: Hunk, proof: MechanicalProof) => ({
  hunkId: hunk.id,
  proof,
  additions: hunk.lines.filter((line) => line.kind === "add").length,
  deletions: hunk.lines.filter((line) => line.kind === "del").length,
});

/**
 * Checks the input fits the model. If it doesn't, drops full file contents, largest first, as
 * few as it can. Hunks are never dropped: when they alone don't fit, the analysis fails.
 */
export const fitToModel = async (
  model: AnalysisModel,
  input: AnalysisInput,
): Promise<Result<{ input: AnalysisInput; warnings: string[] }, UseCaseError>> => {
  const first = await model.checkSize(input);
  if (first.ok) return ok({ input, warnings: [] });
  if (first.error.kind !== "too-large") return err(appError("model-error", first.error.message));

  const largestFirst = input.files
    .flatMap((file) => (file.headContent === null ? [] : [file]))
    .sort((a, b) => (b.headContent?.length ?? 0) - (a.headContent?.length ?? 0))
    .map((file) => file.path);
  const without = (n: number): AnalysisInput => {
    const dropped = new Set(largestFirst.slice(0, n));
    return {
      ...input,
      files: input.files.map((file) =>
        dropped.has(file.path) ? { ...file, headContent: null } : file,
      ),
    };
  };

  const failure = (error: ModelError): UseCaseError =>
    appError(
      "model-error",
      error.kind === "too-large"
        ? `The pull request is too large to analyze, even without full file contents: ${error.message}`
        : error.message,
    );
  if (largestFirst.length === 0) return err(failure(first.error));
  const all = await model.checkSize(without(largestFirst.length));
  if (!all.ok) return err(failure(all.error));

  // Dropping fewer files never fits better, so a binary search finds the fewest that do.
  let fits = largestFirst.length;
  let tooLarge = 0;
  while (fits - tooLarge > 1) {
    const middle = Math.floor((fits + tooLarge) / 2);
    const result = await model.checkSize(without(middle));
    if (result.ok) fits = middle;
    else if (result.error.kind === "too-large") tooLarge = middle;
    else return err(failure(result.error));
  }
  return ok({
    input: without(fits),
    warnings: [`Full file contents omitted for ${count(fits, "file")} to fit the model's limit`],
  });
};
