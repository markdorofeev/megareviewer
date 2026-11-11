// hunk: shadcn base-nova, mapped to Indigo Calm: type scale (text-ui, text-caption), radius
// (controls md, popups xl), the base layer's 2px focus outline instead of ring-3, no dark: overrides.
import type * as React from "react";
import { cn } from "../lib/utils.ts";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor or nest the control.
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-ui leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
