// hunk: Badge for a state from lib/status.ts. The glyph is required and hidden from screen
// readers, which read the label.
import type { StatusStyle } from "../lib/status.ts";
import { cn } from "../lib/utils.ts";
import { Badge } from "./badge.tsx";

interface StatusBadgeProps {
  readonly status: StatusStyle;
  /** Replaces the status's own label, e.g. with a count ("3 contract"). */
  readonly label?: string;
  readonly className?: string;
}

function StatusBadge({ status, label = status.label, className }: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn(status.className, className)}>
      <span aria-hidden="true">{status.glyph}</span>
      {label}
    </Badge>
  );
}

export { StatusBadge };
