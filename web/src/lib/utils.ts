import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The type scale's names (globals.css, --text-*) aren't Tailwind's, and unknown `text-*` classes
// would merge as colors: `cn("text-ui", "text-foreground")` would drop the size.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "title",
        "heading",
        "body",
        "ui",
        "caption",
        "code",
        "code-compact",
        "code-comfy",
        "kbd",
      ],
    },
  },
});

/** Joins class names, a later Tailwind utility replacing an earlier one for the same property. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
