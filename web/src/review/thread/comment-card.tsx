import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

/** What a comment card holds: the reviewer's draft, or a host thread that's open, resolved or outdated. */
export type CommentState = "draft" | "open" | "resolved" | "outdated";

const BAR: Readonly<Record<CommentState, string>> = {
  draft: "bg-review-pending",
  open: "bg-thread-marker",
  resolved: "bg-review-approved",
  outdated: "bg-muted-foreground",
};

/**
 * The card a draft and a thread both sit in, inset under their line: a bar in the state's color,
 * apart from the card's edge, beside a word that says the state too. A field inside takes the focus
 * outline in place of its border rather than around it.
 */
export const CommentCard = ({
  as: Element = "div",
  state,
  className,
  children,
  ...props
}: Omit<ComponentProps<"article">, "ref"> & {
  readonly as?: "article" | "div";
  readonly state: CommentState;
}) => (
  <Element
    data-slot="comment-card"
    data-state={state}
    className={cn(
      "relative rounded-lg border bg-thread-bg py-2.5 pr-4 pl-5 font-sans",
      "[&_:is(textarea,input):focus-visible]:-outline-offset-1",
      className,
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      data-slot="comment-bar"
      className={cn("absolute top-2 bottom-2 left-1.5 w-[3px] rounded-full", BAR[state])}
    />
    {children}
  </Element>
);
