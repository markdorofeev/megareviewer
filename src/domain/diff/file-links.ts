import { z } from "zod";
import type { FileSymbols } from "./call-graph.ts";
import { importReach, languageFamily } from "./imports.ts";
import { isTestFile } from "./test-files.ts";
import type { FileChange } from "./types.ts";

/** An import in `from` that reaches the changed file `to`. */
export const FileLink = z.object({ from: z.string().min(1), to: z.string().min(1) }).readonly();
export type FileLink = z.infer<typeof FileLink>;

/**
 * Changed files that an import in another changed file reaches, by the same rules as the hints:
 * within a language family, and never from production code into tests. A Python import of names
 * reaches the module it names, not every file of its package: `from pkg import mod` links to
 * pkg/mod.py, and `from pkg.mod import f` to pkg/mod.py. One link per pair, in diff order.
 */
export const fileLinks = (
  files: readonly FileChange[],
  symbolsByPath: ReadonlyMap<string, FileSymbols>,
): FileLink[] =>
  files.flatMap((from) => {
    const language = from.language;
    if (language === null) return [];
    const reaches = (symbolsByPath.get(from.path)?.imports ?? []).flatMap(
      (symbolImport) => importReach(from.path, language, symbolImport) ?? [],
    );
    return files
      .filter(
        (to) =>
          to.path !== from.path &&
          to.language !== null &&
          languageFamily(to.language) === languageFamily(language) &&
          (isTestFile(from.path) || !isTestFile(to.path)) &&
          reaches.some((reach) => reach.member(to.path)),
      )
      .map((to) => ({ from: from.path, to: to.path }));
  });
