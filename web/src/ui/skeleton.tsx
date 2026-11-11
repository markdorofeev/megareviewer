// hunk: shadcn base-nova, mapped to Indigo Calm: type scale (text-ui, text-caption), radius
// (controls md, popups xl), the base layer's 2px focus outline instead of ring-3, no dark: overrides.
import { cn } from "../lib/utils.ts";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
