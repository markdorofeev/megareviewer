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
