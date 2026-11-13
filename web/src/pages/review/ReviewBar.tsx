import { type ReactNode, useEffect, useRef, useState } from "react";
import type { PublicationReceipt } from "../../../../src/domain/review/index.ts";

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
 * The row under the header that stays at the top of the window while the code scrolls: Claude's
 * run and the stepper through its points, the layout switch, and Publish. Its height is
 * `--review-bar-h`, which what sticks or scrolls under it reads. Stuck, it names the PR first.
 */
export const ReviewBar = ({
  title,
  claude,
  tools,
  publish,
  publication,
  hairline,
  stuck: stuckAs,
}: {
  /** The PR's title, shown once the header has scrolled away. */
  readonly title: string | null;
  /** Claude's run, its chips and the stepper. */
  readonly claude: ReactNode;
  /** The layout switch, and Show files at 1024px or less. */
  readonly tools: ReactNode;
  /** The Publish button, while the review can be published. */
  readonly publish: ReactNode;
  readonly publication: PublicationReceipt | null;
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
      className="sticky top-0 z-20 flex h-(--review-bar-h) min-w-0 items-center gap-3 border-b bg-background"
    >
      {hairline !== null && (
        // Drawn by globals.css: a still, full-width bar under reduced motion.
        <span data-slot="model-hairline" data-state={hairline} aria-hidden="true">
          <span />
        </span>
      )}
      {stuck && title !== null && (
        // The h1 above still names the page.
        <span
          aria-hidden="true"
          className="max-w-72 shrink truncate font-semibold max-xl:hidden"
          title={title}
        >
          {title}
        </span>
      )}
      <div data-slot="claude-slot" className="flex min-w-0 flex-1 items-center">
        {claude}
      </div>
      <div className="flex shrink-0 items-center gap-2">{tools}</div>
      {publication !== null ? (
        <p
          role="status"
          className="flex shrink-0 items-center gap-1 font-medium text-review-approved"
        >
          <span aria-hidden="true">✓</span>{" "}
          {publication.url === null ? (
            "Published"
          ) : (
            <a
              href={publication.url}
              target="_blank"
              rel="noreferrer"
              className="text-review-approved"
            >
              Published
            </a>
          )}
        </p>
      ) : (
        publish
      )}
    </div>
  );
};
