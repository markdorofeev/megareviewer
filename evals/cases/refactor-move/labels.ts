import type { CaseLabels } from "../../labels.ts";

// Every hunk is proved mechanical, so the model has nothing to classify. Nothing is expected
// of it, and any mismatch it reports is a false positive.
export const labels: CaseLabels = { risk: {}, findings: [], decisions: [], mismatches: [] };
