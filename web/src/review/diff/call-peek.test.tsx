import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CallPayload,
  CallPeek,
  CallTrigger,
  createCallPeekHandle,
  definitionLine,
  PEEK_CLOSE_MS,
  PEEK_OPEN_MS,
} from "./call-peek.tsx";
import { type Highlighter, HighlighterContext } from "./syntax.ts";
import { firstHunk, modifiedFile } from "./testing.ts";

const receipts = modifiedFile("src/services/receipts.ts", [
  "@@ -40,2 +40,4 @@",
  " const cache = new Map();",
  "-export const cachedReceipt = (order) => render(order);",
  "+/** Receipts don't change. */",
  "+export const cachedReceipt = (order) =>",
  "+  cache.get(order.id) ?? render(order);",
]);
const hunk = firstHunk(receipts);
const payload: CallPayload = {
  symbol: "cachedReceipt",
  targets: [{ id: hunk.id, hunk, file: receipts }],
};

/** Never finishes, so the code stays plain text. */
const pendingHighlighter: Highlighter = { highlight: () => new Promise(() => {}) };

const Page = ({ onGoTo }: { readonly onGoTo: (id: string) => void }) => {
  const handle = createCallPeekHandle();
  return (
    <HighlighterContext.Provider value={pendingHighlighter}>
      <p>
        send(await{" "}
        <CallTrigger handle={handle} payload={payload} id="call-1">
          cachedReceipt
        </CallTrigger>
        (order))
      </p>
      <p>elsewhere</p>
      <CallPeek handle={handle} onGoTo={onGoTo} />
    </HighlighterContext.Provider>
  );
};

const renderPage = (ui: ReactNode) => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  return { user, ...render(ui) };
};

const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const card = () =>
  screen.queryByRole("dialog") ?? screen.queryByLabelText("Code cachedReceipt runs");

describe("CallPeek", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the code a call runs once the pointer rests on it", async () => {
    const { user } = renderPage(<Page onGoTo={() => {}} />);
    await user.hover(screen.getByText("cachedReceipt"));
    await wait(PEEK_OPEN_MS / 2);
    expect(card()).toBeNull();
    await wait(PEEK_OPEN_MS);
    expect(card()).not.toBeNull();
    expect(screen.getByRole("table", { name: "Lines of cachedReceipt" }).textContent).toContain(
      "cache.get(order.id)",
    );
    expect(screen.getByText("lines 40–43").textContent).toBe("lines 40–43");
  });

  it("stays open while the pointer is on the card, and closes once it leaves both", async () => {
    const { user } = renderPage(<Page onGoTo={() => {}} />);
    await user.hover(screen.getByText("cachedReceipt"));
    await wait(PEEK_OPEN_MS * 2);
    const opened = card();
    if (opened === null) throw new Error("the card didn't open");
    await user.hover(opened);
    await wait(PEEK_CLOSE_MS * 4);
    expect(card()).not.toBeNull();
    await user.hover(screen.getByText("elsewhere"));
    await wait(PEEK_CLOSE_MS * 4);
    expect(card()).toBeNull();
  });

  it("closes on Esc", async () => {
    const { user } = renderPage(<Page onGoTo={() => {}} />);
    await user.hover(screen.getByText("cachedReceipt"));
    await wait(PEEK_OPEN_MS * 2);
    await user.keyboard("{Escape}");
    await wait(PEEK_CLOSE_MS * 4);
    expect(card()).toBeNull();
  });

  it("goes to the part and closes", async () => {
    const onGoTo = vi.fn();
    const { user } = renderPage(<Page onGoTo={onGoTo} />);
    await user.hover(screen.getByText("cachedReceipt"));
    await wait(PEEK_OPEN_MS * 2);
    await user.click(screen.getByRole("button", { name: "Go to file" }));
    await wait(PEEK_CLOSE_MS * 4);
    expect(onGoTo).toHaveBeenCalledWith(hunk.id);
    expect(card()).toBeNull();
  });
});

describe("definitionLine", () => {
  it("starts at the line that defines the name, past deleted ones", () => {
    expect(definitionLine(hunk, "cachedReceipt")).toBe(3);
  });

  it("falls back to the first line naming it, then to the first line", () => {
    expect(definitionLine(hunk, "render")).toBe(4);
    expect(definitionLine(hunk, "missing")).toBe(0);
  });

  it("matches whole names only", () => {
    expect(definitionLine(hunk, "Receipt")).toBe(0);
  });
});
