import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { partHunk } from "../../../../src/domain/diff/index.ts";
import type { RiskAssessment, RiskClass } from "../../../../src/domain/review/index.ts";
import { HunkCard, type HunkCardProps } from "./hunk-card.tsx";
import { type Highlighter, HighlighterContext } from "./syntax.ts";
import { firstHunk, modifiedFile, parseFiles } from "./testing.ts";

/** Never finishes, so cards stay plain text. */
const pendingHighlighter = (): Highlighter => ({ highlight: () => new Promise(() => {}) });

const renderWith = (ui: ReactNode, highlighter: Highlighter = pendingHighlighter()) =>
  render(ui, {
    wrapper: ({ children }) => (
      <HighlighterContext.Provider value={highlighter}>{children}</HighlighterContext.Provider>
    ),
  });

const orders = modifiedFile(
  "src/routes/orders.ts",
  [
    "@@ -12,3 +12,3 @@ export const ordersRouter = Router();",
    " ordersRouter.get(async (req, res) => {",
    "-  res.json(orders.map(toResponse));",
    "+  res.json({ items: orders.map(toResponse) });",
    " });",
  ],
  ["@@ -40,2 +40,3 @@", " a", "+b", " c"],
);

const card = (index: number, riskClass: RiskClass, reason = `${riskClass} reason`) => {
  const hunk = orders.hunks[index];
  if (hunk === undefined) throw new Error(`no hunk ${index}`);
  const risk: RiskAssessment = { hunkId: hunk.id, riskClass, reason, source: "model" };
  return { hunk, file: orders, risk };
};

const first = card(0, "contract", "Changes the response shape.");
const second = card(1, "logic");
const firstName = "src/routes/orders.ts, lines 12–14";
const secondName = "src/routes/orders.ts, lines 40–42";

const Cards = ({
  cards = [first, second],
  ...props
}: Partial<HunkCardProps> & { readonly cards?: readonly ReturnType<typeof card>[] }) => (
  <>
    {cards.map((one) => (
      <HunkCard
        key={one.hunk.id}
        {...one}
        {...props}
        focused={props.focused === true && one === first}
      />
    ))}
  </>
);

const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HunkCard", () => {
  it("shows the file, its status, the section heading, its counts and its risk in the header", () => {
    renderWith(<Cards />);
    const header = screen.getByRole("region", { name: firstName }).querySelector("header");
    expect(header?.textContent).toBe(
      "src/routes/orders.tsMmodifiedexport const ordersRouter = Router();+1 −1▲Contract: Changes the response shape.",
    );
  });

  it("shows old and new line numbers, a spoken kind and the code on each line", () => {
    renderWith(<Cards />);
    const rows = within(screen.getByRole("region", { name: firstName })).getAllByRole("row");
    expect(rows.map(cells)).toEqual([
      ["12", "12", "unchanged line 12: ordersRouter.get(async (req, res) => {"],
      ["13", "", "removed line 13:   res.json(orders.map(toResponse));"],
      ["", "13", "added line 13:   res.json({ items: orders.map(toResponse) });"],
      ["14", "14", "unchanged line 14: });"],
    ]);
  });

  it("marks the changed words of a pair of lines", () => {
    const { container } = renderWith(<Cards />);
    expect(
      [...container.querySelectorAll("[data-changed]")].map((word) => word.textContent),
    ).toEqual(["{ items: ", " }"]);
  });

  it("tells each part's risk by a bar and a word, on a file's card", () => {
    renderWith(<Cards inFile />);
    const bar = screen
      .getByRole("region", { name: firstName })
      .querySelector("[data-slot=part-risk]");
    expect(bar?.getAttribute("data-risk")).toBe("contract");
    expect(bar?.textContent).toBe("contract");
    // On a file's card the file is named once, by the card: a part has no header of its own.
    expect(screen.getByRole("region", { name: firstName }).querySelector("header")).toBeNull();
  });

  it("marks each card's risk class and the highlighted ones", () => {
    renderWith(<Cards highlighted />);
    const one = screen.getByRole("region", { name: firstName });
    expect(one.dataset.risk).toBe("contract");
    expect(one.dataset.highlighted).toBe("true");
  });

  it("focuses and scrolls to the focused hunk", () => {
    renderWith(<Cards focused />);
    expect(document.activeElement).toBe(screen.getByRole("region", { name: firstName }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("doesn't scroll to a hunk that already has focus", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWith(<Cards />);
    await user.click(within(screen.getByRole("region", { name: firstName })).getByText(/^\}\);$/));
    rerender(<Cards focused />);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("reports a hunk focused by clicking or tabbing to its card", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    renderWith(<Cards onFocus={onFocus} />);
    await user.click(within(screen.getByRole("region", { name: secondName })).getByText("b"));
    expect(onFocus).toHaveBeenLastCalledWith(second.hunk.id);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("region", { name: firstName }));
    expect(onFocus).toHaveBeenLastCalledWith(first.hunk.id);
  });

  it("puts a comment button on each line number when comments can be written", async () => {
    const user = userEvent.setup();
    const onOpenComment = vi.fn();
    renderWith(<Cards cards={[first]} onOpenComment={onOpenComment} onComment={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Comment on old line 13" }));
    expect(onOpenComment).toHaveBeenCalledWith(first.hunk.id, { side: "old", line: 13 });
    expect(screen.getByRole("button", { name: "Comment on line 14" })).toBeTruthy();
  });

  it("swaps in syntax tokens when they're ready", async () => {
    const highlighter: Highlighter = {
      highlight: async (code) => code.split("\n").map((text) => [{ text, type: "keyword" }]),
    };
    const { container } = renderWith(<Cards cards={[second]} />, highlighter);
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".text-syntax-keyword")).toHaveLength(3),
    );
  });

  it("highlights each part of a split hunk from its own lines", async () => {
    const highlighter: Highlighter = {
      highlight: async (code) => code.split("\n").map((text) => [{ text, type: "string" }]),
    };
    const file = modifiedFile("src/a.ts", [
      "@@ -1,2 +1,2 @@",
      "-const a = 1;",
      "+const a = 2;",
      "-const b = 1;",
      "+const b = 2;",
    ]);
    const hunk = firstHunk(file);
    const risk: RiskAssessment = {
      hunkId: hunk.id,
      riskClass: "logic",
      reason: "",
      source: "model",
    };
    const parts = [partHunk(hunk, { start: 0, end: 2 }), partHunk(hunk, { start: 2, end: 4 })];
    const { container } = renderWith(
      parts.map((part) => <HunkCard key={part.newStart} hunk={part} file={file} risk={risk} />),
      highlighter,
    );
    const cards = [...container.querySelectorAll("[data-slot=hunk-card]")];
    await vi.waitFor(() =>
      expect(cards.every((one) => one.querySelector(".text-syntax-string") !== null)).toBe(true),
    );
    expect(cards.map((one) => one.querySelector("[role=table]")?.textContent)).toEqual([
      expect.stringMatching(/const a = 1;.*const a = 2;/),
      expect.stringMatching(/const b = 1;.*const b = 2;/),
    ]);
  });

  it("leaves files in unknown languages plain without asking the highlighter", () => {
    const highlight = vi.fn(pendingHighlighter().highlight);
    const file = modifiedFile("notes.weird", ["@@ -1 +1 @@", "-a", "+b"]);
    const hunk = firstHunk(file);
    renderWith(
      <HunkCard
        hunk={hunk}
        file={file}
        risk={{ hunkId: hunk.id, riskClass: "logic", reason: "", source: "model" }}
      />,
      { highlight },
    );
    expect(highlight).not.toHaveBeenCalled();
  });

  it("notes a missing newline at end of file and a line ending that differs", () => {
    const file = modifiedFile("a.ini", [
      "@@ -1,2 +1,2 @@",
      "-a = 1",
      "\\ No newline at end of file",
      "+a = 1\r",
      " b\r",
    ]);
    const hunk = firstHunk(file);
    renderWith(
      <HunkCard
        hunk={hunk}
        file={file}
        risk={{ hunkId: hunk.id, riskClass: "logic", reason: "", source: "model" }}
      />,
    );
    expect(screen.getAllByRole("row").map((row) => cells(row)[2])).toEqual([
      "removed line 1: a = 1No newline at end of file",
      "added line 1: a = 1CRLF",
      "unchanged line 2: bCRLF",
    ]);
  });

  it("shows a renamed file's old and new paths", () => {
    const [file] = parseFiles([
      "diff --git a/src/token.ts b/src/credentials.ts",
      "similarity index 90%",
      "rename from src/token.ts",
      "rename to src/credentials.ts",
      "--- a/src/token.ts",
      "+++ b/src/credentials.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ]);
    if (file === undefined) throw new Error("no file");
    const hunk = firstHunk(file);
    renderWith(
      <HunkCard
        hunk={hunk}
        file={file}
        risk={{ hunkId: hunk.id, riskClass: "logic", reason: "", source: "model" }}
      />,
    );
    expect(screen.getByRole("region").querySelector("header")?.textContent).toMatch(
      /^src\/token\.ts →renamed to src\/credentials\.tsRrenamed/,
    );
  });
});
