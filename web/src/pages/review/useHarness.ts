import { useEffect, useState } from "react";
import type { HarnessUse } from "../../../../contracts/index.ts";
import { type AnalysisId, GUIDELINE_PATHS } from "../../../../src/domain/review/index.ts";
import { useApi } from "../../api/index.ts";
import { importedRead } from "./UsageFooter.tsx";

/** How soon a harness that's still loading is asked about again. */
export const LOADING_REFRESH_MS = 2_000;

/**
 * The harness an AI review of the analysis would use, read live: when the page opens and when the
 * window is back in focus, since the reviewer switches files on another page, and again while it
 * loads. A read that fails keeps the last one.
 */
export const useHarness = (analysisId: AnalysisId): HarnessUse | null => {
  const { client } = useApi();
  const [harness, setHarness] = useState<HarnessUse | null>(null);

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      clearTimeout(timer);
      const result = await client.getHarness(analysisId);
      if (!current || !result.ok) return;
      setHarness(result.value);
      clearTimeout(timer);
      if (result.value.status === "loading") timer = setTimeout(read, LOADING_REFRESH_MS);
    };
    void read();
    window.addEventListener("focus", read);
    return () => {
      current = false;
      clearTimeout(timer);
      window.removeEventListener("focus", read);
    };
  }, [client, analysisId]);

  return harness;
};

const AND = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * "Reads CLAUDE.md and 3 files it imports; 66 more on request": what a review would use of the
 * repository's harness. Null while it loads, and when there's nothing to use.
 */
export const harnessLine = (harness: HarnessUse | null): string | null => {
  if (harness === null) return null;
  const { inPrompt, onRequest } = harness;
  const roots = inPrompt.filter((path) => GUIDELINE_PATHS.some((root) => root === path));
  const imported = importedRead(roots.length, inPrompt.length - roots.length);
  const read = [...roots, ...(imported === null ? [] : [imported])];
  if (read.length > 0) {
    return `Reads ${AND.format(read)}${onRequest === 0 ? "" : `; ${onRequest} more on request`}`;
  }
  return onRequest === 0
    ? null
    : `Can read ${onRequest} guideline ${onRequest === 1 ? "file" : "files"} on request`;
};
