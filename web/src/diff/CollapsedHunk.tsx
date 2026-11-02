import "./diff.css";
import { memo, useEffect, useRef, useState } from "react";
import type { FileChange, Hunk, HunkId, MechanicalProof } from "../../../src/domain/diff/index.ts";
import type { RiskAssessment } from "../../../src/domain/review/index.ts";
import { HunkCard } from "./HunkCard.tsx";
import { hunkLocation, lineCounts } from "./lines.ts";
import { MECHANICAL_LINE_LIMIT } from "./MechanicalGroup.tsx";

/**
 * A mechanical hunk among the changes to review: one dimmed row with its proof, so it doesn't
 * take attention, that expands to the hunk's card.
 */
export const CollapsedHunk = memo(function CollapsedHunk({
  hunk,
  file,
  risk,
  proofs,
  focused = false,
  onFocus,
}: {
  readonly hunk: Hunk;
  readonly file: FileChange;
  readonly risk: RiskAssessment | null;
  readonly proofs: readonly MechanicalProof[];
  readonly focused?: boolean;
  readonly onFocus?: (id: HunkId) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { added, deleted } = lineCounts(hunk);

  useEffect(() => {
    const button = ref.current;
    if (!focused || button === null || button === document.activeElement) return;
    button.focus({ preventScroll: true });
    button.scrollIntoView({ block: "start" });
  }, [focused]);

  return (
    <div className="collapsed-hunk">
      <button
        ref={ref}
        type="button"
        className="mechanical-summary mechanical-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => onFocus?.(hunk.id)}
      >
        {file.path}, {hunkLocation(hunk)} — {proofs.map((proof) => proof.detail).join("; ")} (+
        {added} −{deleted})
      </button>
      {open && (
        <HunkCard
          hunk={hunk}
          file={file}
          risk={risk}
          proofs={proofs}
          lineLimit={MECHANICAL_LINE_LIMIT}
        />
      )}
    </div>
  );
});
