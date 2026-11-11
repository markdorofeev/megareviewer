import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  FileChange,
  Hunk,
  HunkId,
  MechanicalProof,
} from "../../../../src/domain/diff/index.ts";
import type { RiskAssessment } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { FilePath, FileStatusBadge } from "./file-path.tsx";
import { HunkCard } from "./hunk-card.tsx";
import { hunkLocation, lineCounts } from "./lines.ts";
import { mechanicalRows } from "./mechanical.ts";

/** Expanded mechanical hunks show this many lines at first. */
export const MECHANICAL_LINE_LIMIT = 500;

const ROW =
  "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-muted-foreground";

/** A collapsed row's toggle: the glyph turns, the text says what it holds. */
const Toggle = ({
  open,
  children,
  ...props
}: {
  readonly open: boolean;
  readonly children: React.ReactNode;
} & React.ComponentProps<"button">) => (
  <button
    type="button"
    data-slot="mechanical-toggle"
    aria-expanded={open}
    className={cn(ROW, "hover:bg-accent hover:text-accent-foreground")}
    {...props}
  >
    <span
      aria-hidden="true"
      className={cn(
        "w-3 shrink-0 transition-transform duration-(--duration-fast) ease-standard",
        !open && "-rotate-90",
      )}
    >
      ▾
    </span>
    <span className="min-w-0">{children}</span>
  </button>
);

/**
 * A mechanical hunk among the changes to review: one muted row with its proof, so it doesn't take
 * attention, that expands to the hunk's lines.
 */
export const MechanicalHunk = memo(function MechanicalHunk({
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
    <div data-slot="mechanical-hunk" className="bg-surface-subtle">
      <Toggle
        ref={ref}
        open={open}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => onFocus?.(hunk.id)}
      >
        {file.path}, {hunkLocation(hunk)} — {proofs.map((proof) => proof.detail).join("; ")} (+
        {added} −{deleted})
      </Toggle>
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

/**
 * Mechanical changes, one collapsed row each with its proof. Each row with a hunk expands to the
 * hunk's card: collapsed, never hidden.
 */
export const MechanicalGroup = ({
  files,
  proofs,
  risk,
}: {
  readonly files: readonly FileChange[];
  /** Includes file-level proofs (hunkId null). */
  readonly proofs: readonly MechanicalProof[];
  readonly risk: readonly RiskAssessment[];
}) => {
  const titleId = useId();
  const rows = useMemo(() => mechanicalRows(files, proofs), [files, proofs]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const expandable = rows.filter((row) => row.hunk !== null).map((row) => row.key);
  const allExpanded = expandable.length > 0 && expandable.every((key) => expanded.has(key));

  if (rows.length === 0) return null;
  const toggle = (key: string) =>
    setExpanded((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-lg border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="flex items-center gap-2 text-heading font-semibold">
          Mechanical changes{" "}
          <span className="tabular rounded-full bg-muted px-2 text-caption font-medium text-muted-foreground">
            {rows.length}
          </span>
        </h2>
        {expandable.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(new Set(allExpanded ? [] : expandable))}
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          const open = expanded.has(row.key);
          return (
            <li key={row.key} className="flex flex-col gap-1">
              {row.hunk === null || row.file === null ? (
                <span className={ROW}>
                  <span aria-hidden="true" className="w-3 shrink-0" />
                  {row.summary}
                </span>
              ) : (
                <Toggle open={open} onClick={() => toggle(row.key)}>
                  {row.summary}
                </Toggle>
              )}
              {open && row.hunk !== null && row.file !== null && (
                <HunkCard
                  hunk={row.hunk}
                  file={row.file}
                  risk={risk.find((assessment) => assessment.hunkId === row.hunk?.id) ?? null}
                  proofs={row.proofs}
                  lineLimit={MECHANICAL_LINE_LIMIT}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export interface FileNotice {
  readonly key: string;
  readonly file: FileChange;
  readonly text: string;
}

const WHAT_HAPPENED: Readonly<Record<FileChange["status"], string>> = {
  added: "added",
  deleted: "deleted",
  modified: "changed",
  renamed: "changed",
};

/**
 * File changes that have no lines to show: binary files, mode changes, and empty files added or
 * deleted. None of these is mechanical: a newly executable file can matter.
 */
export const fileNotices = (files: readonly FileChange[]): FileNotice[] =>
  files.flatMap((file) => {
    const modeChanged = file.oldMode !== null || file.newMode !== null;
    // A rename without hunks has a mechanical proof instead.
    const nothingElse =
      !file.binary && !modeChanged && file.hunks.length === 0 && file.status !== "renamed";
    return [
      ...(file.binary
        ? [{ key: `${file.path}\0binary`, file, text: `binary file ${WHAT_HAPPENED[file.status]}` }]
        : []),
      ...(modeChanged
        ? [
            {
              key: `${file.path}\0mode`,
              file,
              text: `mode ${file.oldMode ?? "unknown"} → ${file.newMode ?? "unknown"}`,
            },
          ]
        : []),
      ...(nothingElse
        ? [
            {
              key: `${file.path}\0empty`,
              file,
              text:
                file.status === "modified"
                  ? "changed, no lines to show"
                  : `empty file ${file.status}`,
            },
          ]
        : []),
    ];
  });

/** File changes without lines, read as logic rather than muted. Nothing when there are none. */
export const FileNotices = ({ files }: { readonly files: readonly FileChange[] }) => {
  const titleId = useId();
  const notices = fileNotices(files);
  if (notices.length === 0) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-lg border bg-card p-3"
    >
      <h2 id={titleId} className="text-heading font-semibold">
        Changes without lines to show
      </h2>
      <ul className="flex flex-col gap-1">
        {notices.map(({ key, file, text }) => (
          <li key={key} className="flex flex-wrap items-center gap-2">
            <FilePath file={file} />
            <FileStatusBadge status={file.status} />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
