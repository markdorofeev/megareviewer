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
 * is `--review-bar-h`, which what sticks or scrolls under it reads. Stuck, it names the PR in the
 * room left before the verdict.
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
      className={cn(
        "sticky top-0 z-20 flex h-(--review-bar-row,var(--review-bar-h)) min-w-0 items-center gap-3 border-y bg-background",
        // Below 768px a state too wide for the row scrolls rather than overlapping; the padding
        // keeps the end controls' focus outline in the scrolled box.
        "max-md:overflow-x-auto max-md:px-1 max-md:[scrollbar-width:none]",
      )}
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
      <div data-slot="claude-slot" className="flex min-w-0 items-center max-md:shrink-0">
        {claude}
      </div>
      {/* Stuck, the PR's title is in it: before the pager, which was the version before, it came in
          as the first step scrolled the page and moved the arrows from under the pointer. From
          1280px its room is kept stuck or not, so the pager is one width either way. The h1 above
          still names the page. */}
      <span aria-hidden="true" className="@container flex min-w-0 flex-1 justify-end xl:min-w-40">
        {stuck && title !== null && (
          <span
            data-slot="bar-title"
            className="hidden truncate font-semibold motion-safe:animate-in motion-safe:fade-in @min-[8rem]:block"
            title={title}
          >
            {title}
          </span>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-2">{tools}</div>
      {verdict !== null && (
        // Publish beside it sends another review: approving after a comment, say.
        <p
          role="status"
          data-slot="your-verdict"
          title={VERDICT_STYLES[verdict.kind].label}
          className={cn(
            "flex shrink-0 items-center gap-1 font-medium",
            VERDICT_STYLES[verdict.kind].className,
          )}
        >
          {verdict.url === null ? (
            <>
              <VerdictIcon kind={verdict.kind} />
              <VerdictWord kind={verdict.kind} />
            </>
          ) : (
            <a
              href={verdict.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-inherit"
            >
              <VerdictIcon kind={verdict.kind} />
              <VerdictWord kind={verdict.kind} />
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

/** Below 768px the icon alone, the word in its tooltip and for screen readers. */
const VerdictWord = ({ kind }: { readonly kind: VerdictLabel["kind"] }) => (
  <span className="max-md:sr-only">{VERDICT_STYLES[kind].label}</span>
);

const VerdictIcon = ({ kind }: { readonly kind: VerdictLabel["kind"] }) => {
  const Icon =
    kind === "changes-requested" ? XIcon : kind === "commented" ? MessageSquareIcon : CheckIcon;
  return <Icon aria-hidden="true" className="size-4" />;
};
