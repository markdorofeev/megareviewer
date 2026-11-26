import { BugIcon, type LucideIcon } from "lucide-react";
import type { FileStatus } from "../../../src/domain/diff/index.ts";
import type {
  CheckState,
  FindingType,
  Point,
  PullRequestState,
  ReviewerVerdict,
  ReviewStatus,
  RiskClass,
  Severity,
} from "../../../src/domain/review/index.ts";

// One map from every state to its label, glyph and token classes. The glyph and the label always
// go with the color, so a state is never told by color alone.

export interface StatusStyle {
  readonly label: string;
  readonly glyph: string;
  /** Text, background and border classes, all from tokens. */
  readonly className: string;
}

/** A finding: its icon and word go everywhere its severity's tint does. */
export const FINDING_STATUS: { readonly label: string; readonly icon: LucideIcon } = {
  label: "Finding",
  icon: BugIcon,
};

/** A finding's type: grey, since its severity has the color. */
export const FINDING_TYPE_STATUS: Readonly<Record<FindingType, StatusStyle>> = {
  logic: { label: "logic", glyph: "ƒ", className: "border-border bg-secondary text-foreground" },
  contract: {
    label: "contract",
    glyph: "◆",
    className: "border-border bg-secondary text-foreground",
  },
  architecture: {
    label: "architecture",
    glyph: "≡",
    className: "border-border bg-secondary text-foreground",
  },
};

/** How much Claude thinks a finding matters, while it's Claude's. */
export const SEVERITY_STATUS: Readonly<Record<Severity, StatusStyle>> = {
  blocking: {
    label: "blocking",
    glyph: "■",
    className: "text-severity-blocker bg-review-changes-bg border-severity-blocker/25",
  },
  major: {
    label: "major",
    glyph: "▲",
    className: "text-severity-major bg-severity-major-bg border-severity-major/25",
  },
  minor: {
    label: "minor",
    glyph: "●",
    className: "text-severity-minor bg-review-pending-bg border-severity-minor/25",
  },
};

/** What colors a point: a finding's severity, or grey for a mismatch no finding names. */
export type PointTone = Severity | "mismatch";

export const pointTone = (point: Pick<Point, "severity">): PointTone =>
  point.severity ?? "mismatch";

/** A point's color as text, as a bar, and as a chip. */
export const POINT_TONE: Readonly<
  Record<PointTone, { readonly text: string; readonly bar: string; readonly chip: string }>
> = {
  blocking: {
    text: "text-severity-blocker",
    bar: "bg-severity-blocker",
    chip: SEVERITY_STATUS.blocking.className,
  },
  major: {
    text: "text-severity-major",
    bar: "bg-severity-major",
    chip: SEVERITY_STATUS.major.className,
  },
  minor: {
    text: "text-severity-minor",
    bar: "bg-severity-minor",
    chip: SEVERITY_STATUS.minor.className,
  },
  mismatch: {
    text: "text-muted-foreground",
    bar: "bg-muted-foreground",
    chip: "border-border bg-muted text-foreground",
  },
};

/** The verdict a published review carries, and the marks the design system still shows. */
export type ReviewMark = "approved" | "rejected" | "pending";

export const VERDICT_STATUS: Readonly<Record<ReviewMark, StatusStyle>> = {
  approved: {
    label: "Approved",
    glyph: "✓",
    className: "text-review-approved bg-review-approved-bg border-review-approved/25",
  },
  rejected: {
    label: "Rejected",
    glyph: "✕",
    className: "text-review-changes bg-review-changes-bg border-review-changes/25",
  },
  pending: {
    label: "Pending",
    glyph: "○",
    className: "text-review-pending bg-review-pending-bg border-review-pending/25",
  },
};

/** The risk classes the page shows: contract only orders the flows. */
export type ShownRisk = Exclude<RiskClass, "contract">;

export const RISK_STATUS: Readonly<Record<ShownRisk, StatusStyle>> = {
  logic: {
    label: "Logic",
    glyph: "●",
    className: "text-risk-logic bg-risk-logic-bg border-risk-logic-border",
  },
  mechanical: {
    label: "Mechanical",
    glyph: "○",
    className: "text-risk-mechanical bg-risk-mechanical-bg border-risk-mechanical-border",
  },
};

/**
 * How a file's status shows. A new or deleted file is a mark: a plus or minus icon in its color,
 * its name in that color too, and the word for screen readers. A rename is a word chip, since its
 * icon and name are those of any file.
 */
export type FileStatusStyle =
  | {
      readonly kind: "mark";
      readonly label: string;
      /** The icon's color. */
      readonly tone: string;
      /** The name's classes. */
      readonly name: string;
    }
  | { readonly kind: "chip"; readonly label: string; readonly className: string };

/**
 * A file's status, said only when it isn't the usual one: nearly every file is modified, so a
 * modified file says nothing.
 */
export const FILE_STATUS: Readonly<Record<FileStatus, FileStatusStyle | null>> = {
  added: { kind: "mark", label: "new", tone: "text-diff-add-fg", name: "text-diff-add-fg" },
  modified: null,
  deleted: {
    kind: "mark",
    label: "deleted",
    tone: "text-diff-del-fg",
    name: "text-diff-del-fg line-through",
  },
  renamed: {
    kind: "chip",
    label: "renamed",
    className: "text-diff-hunk-fg bg-diff-hunk-bg border-diff-hunk-fg/25",
  },
};

/**
 * A PR's state on its host, always shown: an icon and a word go with its tint. Open, which nearly
 * every PR reviewed is, is grey, leaving indigo to actions and AI.
 */
export const PR_STATE_STATUS: Readonly<
  Record<PullRequestState, { readonly label: string; readonly className: string }>
> = {
  open: { label: "Open", className: "text-foreground bg-secondary border-transparent" },
  draft: { label: "Draft", className: "text-muted-foreground bg-muted border-border" },
  merged: { label: "Merged", className: "text-pr-merged bg-pr-merged-bg border-pr-merged/25" },
  closed: {
    label: "Closed",
    className: "text-review-changes bg-review-changes-bg border-review-changes/25",
  },
};

/** What the PR's reviews add up to, shown only when it's approved or changes are requested. */
export const REVIEW_STATUS: Readonly<Record<ReviewStatus, StatusStyle>> = {
  approved: {
    label: "Approved",
    glyph: "✓",
    className: "text-review-approved bg-review-approved-bg border-review-approved/25",
  },
  "changes-requested": {
    label: "Changes requested",
    glyph: "✕",
    className: "text-review-changes bg-review-changes-bg border-review-changes/25",
  },
};

/** A check's state: its glyph, its word and the glyph's color. */
export const CHECK_STATUS: Readonly<
  Record<CheckState, { readonly label: string; readonly glyph: string; readonly tone: string }>
> = {
  passed: { label: "Passed", glyph: "✓", tone: "text-ci-success" },
  failed: { label: "Failed", glyph: "✕", tone: "text-ci-failure" },
  running: { label: "Running", glyph: "◌", tone: "text-ci-running" },
  skipped: { label: "Skipped", glyph: "–", tone: "text-ci-skipped" },
};

/** A reviewer's verdict, in words and as the mark on their initials. */
export const REVIEWER_VERDICT: Readonly<
  Record<ReviewerVerdict | "waiting", { readonly label: string; readonly tone: string }>
> = {
  "changes-requested": { label: "Requested changes", tone: "text-review-changes" },
  approved: { label: "Approved", tone: "text-review-approved" },
  commented: { label: "Commented", tone: "text-review-commented" },
  waiting: { label: "Not reviewed yet", tone: "text-muted-foreground" },
};
