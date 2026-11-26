import { type ReactNode, useEffect, useMemo, useRef } from "react";
import type { FileChange, Hunk, PartId } from "../../../../src/domain/diff/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import {
  createHoverCardHandle,
  HoverCard,
  HoverCardContent,
  type HoverCardHandle,
  HoverCardTrigger,
} from "../../ui/hover-card.tsx";
import { DiffLine, LineEnd } from "./diff-line.tsx";
import { FilePath } from "./file-path.tsx";
import { PINNED } from "./hunk-card.tsx";
import { hunkLocation, lineCounts } from "./lines.ts";
import { viewLines } from "./rows.ts";
import { useHunkTokens } from "./syntax.ts";

/** How long the pointer rests on a call before its code shows. */
export const PEEK_OPEN_MS = 300;
/**
 * How long the code stays after the pointer leaves the call or the card, so the pointer can cross
 * the gap between them.
 */
export const PEEK_CLOSE_MS = 150;

/** A part a call runs: the code the card shows. */
export interface CallTarget {
  readonly id: PartId;
  readonly hunk: Hunk;
  readonly file: FileChange;
}

/** What a call carries to the card: its name and the parts it runs, in diff order. */
export interface CallPayload {
  readonly symbol: string;
  readonly targets: readonly CallTarget[];
}

export type CallPeekHandle = HoverCardHandle<CallPayload>;

/** One per page: the calls' triggers and the card they open share it. */
export const createCallPeekHandle = (): CallPeekHandle => createHoverCardHandle<CallPayload>();

/**
 * A call in the code: a dotted underline says it opens its code, solid under the pointer, and
 * resting there opens it. The dots are in the text's own color, which passes on every line and
 * word tint; muted grey was 2.85:1 on a changed word in dark.
 */
export const CallTrigger = ({
  handle,
  payload,
  id,
  children,
}: {
  readonly handle: CallPeekHandle;
  readonly payload: CallPayload;
  /** For the keyboard to open the card on this call. */
  readonly id: string;
  readonly children: ReactNode;
}) => (
  <HoverCardTrigger
    handle={handle}
    payload={payload}
    id={id}
    delay={PEEK_OPEN_MS}
    closeDelay={PEEK_CLOSE_MS}
    render={<span />}
    data-slot="call"
    className="underline decoration-current decoration-dotted underline-offset-3 hover:decoration-primary hover:decoration-solid data-popup-open:decoration-primary data-popup-open:decoration-solid"
  >
    {children}
  </HoverCardTrigger>
);

/**
 * The card a call opens: the code of each part it runs, as the map shows it, and a way to the part
 * on the map. It stays open while the pointer is on the call or on the card.
 */
export const CallPeek = ({
  handle,
  onGoTo,
}: {
  readonly handle: CallPeekHandle;
  readonly onGoTo: (id: PartId) => void;
}) => (
  <HoverCard handle={handle}>
    {({ payload }) =>
      payload === undefined ? null : (
        <HoverCardContent
          side="bottom"
          align="start"
          aria-label={`Code ${payload.symbol} runs`}
          className="flex max-h-[min(26rem,60vh)] w-[min(44rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
        >
          <PeekBody
            payload={payload}
            onGoTo={(id) => {
              handle.close();
              onGoTo(id);
            }}
          />
        </HoverCardContent>
      )
    }
  </HoverCard>
);

const PeekBody = ({
  payload,
  onGoTo,
}: {
  readonly payload: CallPayload;
  readonly onGoTo: (id: PartId) => void;
}) => {
  const scroller = useRef<HTMLDivElement>(null);
  const first = payload.targets[0];
  // The card opens on the line that defines the name, under its part's header.
  const start =
    first === undefined ? null : `${first.hunk.id}:${definitionLine(first.hunk, payload.symbol)}`;
  useEffect(() => {
    const box = scroller.current;
    const row = start === null ? null : box?.querySelector<HTMLElement>(`[data-line="${start}"]`);
    const header = box?.querySelector<HTMLElement>("header");
    if (box == null || row == null) return;
    box.scrollTop = row.offsetTop - (header?.offsetHeight ?? 0);
  }, [start]);
  return (
    // The parts' lines scroll sideways together, with each header held at the visible width.
    <div
      ref={scroller}
      data-slot="peek-scroller"
      className="@container relative min-h-0 overflow-auto"
    >
      <div className="w-max min-w-full">
        {payload.targets.map((target, at) => (
          <PeekPart
            key={target.id}
            target={target}
            symbol={payload.symbol}
            onGoTo={onGoTo}
            divided={at > 0}
            last={at === payload.targets.length - 1}
          />
        ))}
      </div>
    </div>
  );
};

const PeekPart = ({
  target,
  symbol,
  onGoTo,
  divided,
  last,
}: {
  readonly target: CallTarget;
  readonly symbol: string;
  readonly onGoTo: (id: PartId) => void;
  /** Not the first part, so a rule sets it apart from the one above. */
  readonly divided: boolean;
  /** The card's last part, whose last line runs on to the card's edge. */
  readonly last: boolean;
}) => {
  const { hunk, file } = target;
  const tokens = useHunkTokens(hunk, file, true);
  const lines = useMemo(() => viewLines(hunk, tokens), [hunk, tokens]);
  const counts = lineCounts(hunk);
  const where = hunkLocation(hunk);
  return (
    <section aria-label={`${file.path}, ${where}`} className={divided ? "border-t" : undefined}>
      <header
        className={cn(
          PINNED,
          "top-0 z-[2] flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-surface-subtle px-3 py-1 text-caption",
        )}
      >
        <FilePath file={file} status={file.status} />
        <span className="text-muted-foreground">{where}</span>
        <span className="tabular font-mono text-code-compact">
          <span className="text-diff-add-fg">+{counts.added}</span>{" "}
          <span className="text-diff-del-fg">−{counts.deleted}</span>
        </span>
        <Button variant="link" size="xs" className="ml-auto px-0" onClick={() => onGoTo(target.id)}>
          Go to file
        </Button>
      </header>
      <div role="table" aria-label={`Lines of ${symbol}`} className="w-max min-w-full">
        {lines.map((line) => (
          // The new side's numbers only: the base's column is empty beside every added line.
          <DiffLine
            key={line.key}
            line={line}
            layout="split-new"
            cellRole="cell"
            density="compact"
          />
        ))}
      </div>
      {/* Room under the last line for a scrollbar drawn over the code, as macOS draws it. */}
      {last && <LineEnd kind={lines.at(-1)?.kind ?? "context"} className="h-3" />}
    </section>
  );
};

/**
 * The line of the part that defines the name, or else the first that names it, or its first line:
 * where the card starts. Deleted lines aren't the definition.
 */
export const definitionLine = (hunk: Hunk, symbol: string): number => {
  const name = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(?<![\\w$])${name}(?![\\w$])`);
  const defines = new RegExp(
    `\\b(def|class|function|func|fn|const|let|var|type|interface|enum|struct|trait|impl)\\b[^=(]*?(?<![\\w$])${name}(?![\\w$])`,
  );
  const shown = hunk.lines
    .map((line, at) => ({ line, at }))
    .filter(({ line }) => line.kind !== "del");
  return (
    shown.find(({ line }) => defines.test(line.text))?.at ??
    shown.find(({ line }) => word.test(line.text))?.at ??
    0
  );
};
