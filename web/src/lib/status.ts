import type { FileStatus } from "../../../src/domain/diff/index.ts";
import type { RiskClass, Verdict } from "../../../src/domain/review/index.ts";

// One map from every state to its label, glyph and token classes. The glyph and the label always
// go with the color, so a state is never told by color alone.

export interface StatusStyle {
  readonly label: string;
  readonly glyph: string;
  /** Text, background and border classes, all from tokens. */
  readonly className: string;
}

export const VERDICT_STATUS: Readonly<Record<Verdict, StatusStyle>> = {
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

/** A file's status as the letter a tree or file header shows, named in full for screen readers. */
export const FILE_STATUS: Readonly<Record<FileStatus, StatusStyle>> = {
  added: { label: "Added", glyph: "A", className: "text-diff-add-fg" },
  modified: { label: "Modified", glyph: "M", className: "text-diff-mod-fg" },
  deleted: { label: "Deleted", glyph: "D", className: "text-diff-del-fg" },
  renamed: { label: "Renamed", glyph: "R", className: "text-diff-hunk-fg" },
};
