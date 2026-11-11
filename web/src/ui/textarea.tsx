// hunk: shadcn base-nova, mapped to Indigo Calm: type scale (text-ui, text-caption), radius
// (controls md, popups xl), the base layer's 2px focus outline instead of ring-3, no dark: overrides.
import type * as React from "react";
import { cn } from "../lib/utils.ts";

// hunk: ⌘↵ (Ctrl+↵ off macOS) calls onSubmitShortcut, for comment composers.
function Textarea({
  className,
  onSubmitShortcut,
  onKeyDown,
  ...props
}: React.ComponentProps<"textarea"> & { readonly onSubmitShortcut?: () => void }) {
  return (
    <textarea
      data-slot="textarea"
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          onSubmitShortcut !== undefined &&
          !event.defaultPrevented &&
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          onSubmitShortcut();
        }
      }}
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-ui transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
