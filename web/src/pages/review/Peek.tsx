import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Hunk, HunkId } from "../../../../src/domain/diff/index.ts";
import { hunkLocation } from "../../diff/index.ts";
import type { CallMark } from "./chips.ts";
import type { HunkDeps } from "./HunkView.tsx";

/** How long the pointer rests on a mention before its peek shows. */
export const PEEK_DELAY_MS = 300;
/** Lines of the called code a peek shows. */
export const PEEK_LINES = 12;

const MARKERS = { context: " ", add: "+", del: "-" } as const;

/**
 * Where a peek starts in the called hunk: the line that defines the symbol, else the first that
 * names it, else the hunk's start.
 */
export const peekStart = (hunk: Hunk, symbol: string): number => {
  const word = new RegExp(`(?<![\\w$])${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`);
  const defines = new RegExp(
    `\\b(def|class|function|func|fn|const|let|var|type|interface|enum|struct)\\s+${word.source}`,
  );
  const shown = hunk.lines
    .map((line, at) => ({ line, at }))
    .filter(({ line }) => line.kind !== "del");
  const found =
    shown.find(({ line }) => defines.test(line.text)) ??
    shown.find(({ line }) => word.test(line.text));
  return found?.at ?? 0;
};

// One peek is open at a time: opening one closes the last.
let closeOpenPeek: (() => void) | null = null;

/**
 * A later call to code the reader has already been shown in this step: the symbol underlined in
 * place. Resting on it or focusing it shows a peek of the called code; a click goes there.
 */
export const Mention = ({
  mark,
  deps,
  children,
}: {
  readonly mark: Extract<CallMark, { kind: "mention" }>;
  readonly deps: HunkDeps;
  readonly children: ReactNode;
}) => {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const [first] = mark.calls;

  const close = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setPlace(null);
  };
  const show = () => {
    const box = button.current?.getBoundingClientRect();
    if (box === undefined) return;
    if (closeOpenPeek !== close) closeOpenPeek?.();
    closeOpenPeek = close;
    setPlace({ top: box.bottom + 4, left: box.left });
  };
  // Focusing the symbol can scroll its line sideways, so the peek follows it rather than closing,
  // and closes once the symbol is out of the window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: listens while open; close only sets state.
  useEffect(() => {
    if (place === null) return;
    const onScroll = () => {
      const box = button.current?.getBoundingClientRect();
      if (box === undefined || box.bottom < 0 || box.top > window.innerHeight) return close();
      setPlace({ top: box.bottom + 4, left: box.left });
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [place]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  if (first === undefined) return children;
  const riskOf = (hunkId: HunkId) =>
    deps.index.mechanical.has(hunkId)
      ? "mechanical"
      : (deps.index.items([hunkId])[0]?.risk.riskClass ?? "logic");
  const riskClass = riskOf(first.toHunkId);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`call-mention risk-${riskClass}`}
        aria-describedby={place === null ? undefined : id}
        onMouseEnter={() => {
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(show, PEEK_DELAY_MS);
        }}
        onMouseLeave={close}
        onFocus={show}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === "Escape" && place !== null) {
            event.stopPropagation();
            close();
          }
        }}
        onClick={() => {
          close();
          deps.onFollow(first.toHunkId);
        }}
      >
        {children}
      </button>
      {place !== null &&
        createPortal(
          <div id={id} role="tooltip" className="peek" style={{ top: place.top, left: place.left }}>
            {mark.calls.map((call) => (
              <PeekOf key={call.toHunkId} hunkId={call.toHunkId} symbol={mark.symbol} deps={deps} />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

const PeekOf = ({
  hunkId,
  symbol,
  deps,
}: {
  readonly hunkId: HunkId;
  readonly symbol: string;
  readonly deps: HunkDeps;
}) => {
  const [item] = deps.index.items([hunkId]);
  if (item === undefined) return null;
  const { hunk, file } = item;
  const riskClass = deps.index.mechanical.has(hunkId) ? "mechanical" : item.risk.riskClass;
  const start = peekStart(hunk, symbol);
  const lines = hunk.lines.slice(start, start + PEEK_LINES);
  const step = deps.stepOf(hunkId);
  return (
    <div className="peek-hunk">
      <p className="peek-head">
        <code className="call-symbol">{symbol}</code> <span>{file.path}</span>{" "}
        <span className="muted">{hunkLocation(hunk)}</span>{" "}
        <span className={`call-risk risk-${riskClass}`}>{riskClass}</span>
        {step !== null && <span className="peek-step muted"> · {step}</span>}
      </p>
      <pre className="peek-code">
        {lines.map((line, at) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a peek's lines don't move.
          <span key={at} className={`peek-line line-${line.kind}`}>
            {MARKERS[line.kind]} {line.text}
          </span>
        ))}
      </pre>
    </div>
  );
};
