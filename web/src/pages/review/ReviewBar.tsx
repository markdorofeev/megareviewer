import { CheckIcon, MessageSquareIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import type { VerdictLabel } from "./header-buttons.ts";

export type HairlineState = "running" | "finishing";

/**
 * Whether the bar is stuck to the top of the window. The window's top edge is moved down a pixel
 * for the observer, so the bar is cut by it only while it sits at the very top.
 */
const useStuck = () => {
  const bar = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const target = bar.current;
    if (target === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry !== undefined) {
          setStuck(entry.intersectionRatio < 1 && entry.boundingClientRect.top <= 0);
        }
      },
      { rootMargin: "-1px 0px 0px 0px", threshold: 1 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return { bar, stuck };
};

/**
 * The row under the header that stays at the top of the window while the code scrolls: the
 * switch between the code and the overview, Claude's run and the pager through its findings, Show
 * files at 1024px or less, the reviewer's verdict on the host, and Approve and Publish. Its height
 * is `--review-bar-h`, which what sticks or scrolls under it reads. Stuck, it names the PR first.
 */
export const ReviewBar = ({
  layout = null,
  title,
  claude,
  tools,
  publish,
  verdict,
  hairline,
  stuck: stuckAs,
}: {
  /** The switch between the code and the overview. */
  readonly layout?: ReactNode;
  /** The PR's title, shown once the header has scrolled away. */
  readonly title: string | null;
  /** Claude's run, its chips and the stepper. */
  readonly claude: ReactNode;
  /** Show files, at 1024px or less. */
  readonly tools: ReactNode;
  /** Approve and Publish, while a review can be published: before and after one is. */
  readonly publish: ReactNode;
  /** The reviewer's verdict on the host, or that a review was published while it's unknown. */
  readonly verdict: VerdictLabel | null;
  /**
   * Claude is reading the PR: a segment runs along the bar's bottom edge. Once it's done, it
   * runs out to the full width and fades.
   */
  readonly hairline: HairlineState | null;
  /** Shows it stuck or not whatever the scroll, for the design system's examples. */
  readonly stuck?: boolean;
}) => {
  const observed = useStuck();
  const stuck = stuckAs ?? observed.stuck;
  return (
    <div
      ref={observed.bar}
      data-slot="review-bar"
      data-stuck={stuck || undefined}
      className="sticky top-0 z-20 flex h-(--review-bar-row,var(--review-bar-h)) min-w-0 items-center gap-3 border-y bg-background"
    >
      {hairline !== null && (
        // Drawn by globals.css: a still, full-width bar under reduced motion.
        <span data-slot="model-hairline" data-state={hairline} aria-hidden="true">
          <span />
        </span>
      )}
      {layout !== null && (
        <span className="flex shrink-0 items-center gap-3">
          {layout}
          <span aria-hidden="true" className="h-4.5 w-px shrink-0 bg-border" />
        </span>
      )}
      {stuck && title !== null && (
        // The h1 above still names the page.
        <span aria-hidden="true" className="flex max-w-96 shrink items-center gap-3 max-xl:hidden">
          <span
            className="truncate font-semibold motion-safe:animate-in motion-safe:fade-in"
            title={title}
          >
            {title}
          </span>
          <span className="h-4.5 w-px shrink-0 bg-border" />
        </span>
      )}
      <div data-slot="claude-slot" className="flex min-w-0 flex-1 items-center">
        {claude}
      </div>
      <div className="flex shrink-0 items-center gap-2">{tools}</div>
      {verdict !== null && (
        // Publish beside it sends another review: approving after a comment, say.
        <p
          role="status"
          data-slot="your-verdict"
          className={cn(
            "flex shrink-0 items-center gap-1 font-medium",
            VERDICT_STYLES[verdict.kind].className,
          )}
        >
          <VerdictIcon kind={verdict.kind} />
          {verdict.url === null ? (
            VERDICT_STYLES[verdict.kind].label
          ) : (
            <a href={verdict.url} target="_blank" rel="noreferrer" className="text-inherit">
              {VERDICT_STYLES[verdict.kind].label}
            </a>
          )}
        </p>
      )}
      <div className="flex shrink-0 items-center gap-2">{publish}</div>
    </div>
  );
};

const VERDICT_STYLES: Readonly<
  Record<VerdictLabel["kind"], { readonly label: string; readonly className: string }>
> = {
  approved: { label: "Approved", className: "text-review-approved" },
  "changes-requested": { label: "Changes requested", className: "text-review-changes" },
  commented: { label: "Commented", className: "text-muted-foreground" },
  published: { label: "Published", className: "text-review-approved" },
};

const VerdictIcon = ({ kind }: { readonly kind: VerdictLabel["kind"] }) => {
  const Icon =
    kind === "changes-requested" ? XIcon : kind === "commented" ? MessageSquareIcon : CheckIcon;
  return <Icon aria-hidden="true" className="size-4" />;
};
