import { BugIcon, type LucideIcon, ScanEyeIcon, SignpostIcon } from "lucide-react";
import type { FileStatus } from "../../../src/domain/diff/index.ts";
import type { PointKind, RiskClass } from "../../../src/domain/review/index.ts";

// One map from every state to its label, glyph and token classes. The glyph and the label always
// go with the color, so a state is never told by color alone.

export interface StatusStyle {
  readonly label: string;
  readonly glyph: string;
  /** Text, background and border classes, all from tokens. */
  readonly className: string;
}

/** A point's kind: its glyph and word go everywhere its tint does. */
export const POINT_STATUS: Readonly<Record<PointKind, StatusStyle>> = {
  finding: {
    label: "Finding",
    glyph: "⚠",
    className: "text-review-changes bg-review-changes-bg border-review-changes/25",
  },
  risk: {
    label: "Risk",
    glyph: "▲",
    className: "text-risk-contract bg-risk-contract-bg border-risk-contract-border",
  },
  // The quietest kind: a footnote, never a request, so it takes no hue.
  decision: {
    label: "Decision",
    glyph: "◇",
    className: "text-muted-foreground bg-muted border-border",
  },
};

/** A point's kind as an icon, beside its word: a bug, a scan, a signpost. */
export const POINT_ICON: Readonly<Record<PointKind, LucideIcon>> = {
  finding: BugIcon,
  risk: ScanEyeIcon,
  decision: SignpostIcon,
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

export const RISK_STATUS: Readonly<Record<RiskClass, StatusStyle>> = {
  contract: {
    label: "Contract",
    glyph: "▲",
    className: "text-risk-contract bg-risk-contract-bg border-risk-contract-border",
  },
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
