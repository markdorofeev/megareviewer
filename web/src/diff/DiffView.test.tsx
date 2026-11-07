import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskAssessment, RiskClass } from "../../../src/domain/review/index.ts";
import { DiffView, type HunkItem } from "./DiffView.tsx";
import { HunkCard, shortPaths } from "./HunkCard.tsx";
import type { Highlighter } from "./highlight.ts";
import { firstHunk, modifiedFile, parseFiles } from "./testing.ts";
import type { CodeToken } from "./tokens.ts";
import { HighlighterContext } from "./useHighlighter.ts";

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

const item = (index: number, riskClass: RiskClass, reason = `${riskClass} reason`): HunkItem => {
  const hunk = orders.hunks[index];
  if (hunk === undefined) throw new Error(`no hunk ${index}`);
  const risk: RiskAssessment = { hunkId: hunk.id, riskClass, reason, source: "model" };
  return { hunk, file: orders, risk };
};

const firstItem = item(0, "contract", "Changes the response shape.");
const secondItem = item(1, "logic");
const items = [firstItem, secondItem];
const first = firstItem.hunk.id;
const second = secondItem.hunk.id;
const firstName = "src/routes/orders.ts, lines 12–14";
const secondName = "src/routes/orders.ts, lines 40–42";

const header = (card: HTMLElement) => card.querySelector("header")?.textContent;

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

describe("DiffView", () => {
  it("shows each hunk as a labelled region in the order given", () => {
    renderWith(<DiffView items={[...items].reverse()} />);
    expect(screen.getAllByRole("region").map((card) => card.getAttribute("aria-label"))).toEqual([
      secondName,
      firstName,
    ]);
  });

  it("shows the file, its status, the section heading and its added and deleted lines in the header", () => {
    renderWith(<DiffView items={items} />);
    expect(header(screen.getByRole("region", { name: firstName }))).toBe(
      "src/routes/orders.tsmodifiedexport const ordersRouter = Router();+1 −1Changes the response shape.contractChanges the response shape.",
    );
  });

  it("shows old and new line numbers, a marker and the code on each line", () => {
    renderWith(<DiffView items={items} />);
    const rows = within(screen.getByRole("region", { name: firstName })).getAllByRole("row");
    expect(rows.slice(1).map(cells)).toEqual([
      ["12", "12", " ", "ordersRouter.get(async (req, res) => {"],
      ["13", "", "-", "  res.json(orders.map(toResponse));"],
      ["", "13", "+", "  res.json({ items: orders.map(toResponse) });"],
      ["14", "14", " ", "});"],
    ]);
  });

  it("marks the changed words of a pair of lines", () => {
    const { container } = renderWith(<DiffView items={items} />);
    expect([...container.querySelectorAll("ins")].map((ins) => ins.textContent)).toEqual([
      "{ items: ",
      " }",
    ]);
    expect(container.querySelectorAll("del")).toHaveLength(0);
  });

  it("names the risk class on the badge and describes it with the reason", () => {
    renderWith(<DiffView items={items} />);
    const badge = screen.getByRole("button", { name: "contract" });
    const reason = document.getElementById(badge.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe("Changes the response shape.");
    expect(reason?.getAttribute("role")).toBe("tooltip");
    expect(screen.getByRole("button", { name: "logic" })).toBeTruthy();
  });

  it("styles each card by its risk class", () => {
    renderWith(<DiffView items={[item(0, "mechanical"), item(1, "contract")]} />);
    expect(screen.getByRole("region", { name: firstName }).classList).toContain("risk-mechanical");
    expect(screen.getByRole("region", { name: secondName }).classList).toContain("risk-contract");
  });

  it("marks highlighted hunks", () => {
    renderWith(<DiffView items={items} highlightedHunkIds={new Set([second])} />);
    expect(screen.getByRole("region", { name: firstName }).classList).not.toContain("highlighted");
    expect(screen.getByRole("region", { name: secondName }).classList).toContain("highlighted");
  });

  it("focuses and scrolls to the focused hunk, and follows it when it changes", () => {
    const { rerender } = renderWith(<DiffView items={items} focusedHunkId={second} />);
    const secondCard = screen.getByRole("region", { name: secondName });
    expect(document.activeElement).toBe(secondCard);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    rerender(<DiffView items={items} focusedHunkId={first} />);
    expect(document.activeElement).toBe(screen.getByRole("region", { name: firstName }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("doesn't scroll to a hunk that already has focus", async () => {
    const user = userEvent.setup();
    const onFocusHunk = vi.fn();
    const { rerender } = renderWith(<DiffView items={items} onFocusHunk={onFocusHunk} />);
    await user.click(within(screen.getByRole("region", { name: secondName })).getByText("b"));
    rerender(<DiffView items={items} focusedHunkId={second} onFocusHunk={onFocusHunk} />);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("reports a hunk focused by clicking or tabbing to its card", async () => {
    const user = userEvent.setup();
    const onFocusHunk = vi.fn();
    renderWith(<DiffView items={items} onFocusHunk={onFocusHunk} />);

    await user.click(within(screen.getByRole("region", { name: secondName })).getByText("b"));
    expect(onFocusHunk).toHaveBeenLastCalledWith(second);

    await user.tab();
    expect(document.activeElement?.textContent).toBe("logic");
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "contract" }));
    expect(onFocusHunk).toHaveBeenLastCalledWith(first);
  });

  it("swaps in highlighted tokens when they're ready", async () => {
    const highlighter: Highlighter = {
      highlight: async (code) =>
        code
          .split("\n")
          .map((line): CodeToken[] => [
            { text: line, light: "#0a3069", dark: "#a5d6ff", italic: false, bold: true },
          ]),
    };
    const { container } = renderWith(<DiffView items={[item(1, "logic")]} />, highlighter);
    await vi.waitFor(() => expect(container.querySelectorAll(".token.bold")).toHaveLength(3));
    const token = container.querySelector<HTMLElement>(".token.bold");
    expect(token?.style.getPropertyValue("--token-light")).toBe("#0a3069");
    expect(token?.style.getPropertyValue("--token-dark")).toBe("#a5d6ff");
  });

  it("leaves files in unknown languages plain without asking the highlighter", () => {
    const highlight = vi.fn(pendingHighlighter().highlight);
    const file = modifiedFile("notes.weird", ["@@ -1 +1 @@", "-a", "+b"]);
    const hunk = firstHunk(file);
    renderWith(
      <DiffView
        items={[
          {
            hunk,
            file,
            risk: { hunkId: hunk.id, riskClass: "logic", reason: "", source: "model" },
          },
        ]}
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
      <DiffView
        items={[
          {
            hunk,
            file,
            risk: { hunkId: hunk.id, riskClass: "logic", reason: "", source: "model" },
          },
        ]}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => cells(row)[3])).toEqual([
      "a = 1No newline at end of file",
      "a = 1CRLF",
      "bCRLF",
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
      <DiffView
        items={[
          {
            hunk,
            file,
            risk: { hunkId: hunk.id, riskClass: "logic", reason: "", source: "model" },
          },
        ]}
      />,
    );
    expect(header(screen.getByRole("region"))).toMatch(
      /^src\/token\.ts →renamed to src\/credentials\.tsrenamed/,
    );
  });
});

describe("callers", () => {
  const callers = [
    { path: "src/services/orders.ts", hunkId: second, test: false },
    { path: "lib/orders.ts", hunkId: second, test: false },
    { path: "tests/test_orders.py", hunkId: first, test: true },
    { path: "tests/fakes.py", hunkId: first, test: true },
  ];

  it("lists each calling file, counts tests until they're opened, and follows a link", async () => {
    const onFollow = vi.fn();
    renderWith(<DiffView items={[firstItem]} callersOf={() => callers} onFollow={onFollow} />);
    const line = screen.getByText("Called from").parentElement;
    expect(line?.textContent).toBe("Called from services/orders.ts ↑, lib/orders.ts ↑ and 2 tests");
    await userEvent.click(screen.getByRole("button", { name: "2 tests" }));
    expect(line?.textContent).toBe(
      "Called from services/orders.ts ↑, lib/orders.ts ↑, test_orders.py ↑ and fakes.py ↑",
    );
    await userEvent.click(screen.getByRole("button", { name: "test_orders.py ↑" }));
    expect(onFollow).toHaveBeenCalledWith(first);
  });

  it("names only the tests when no production code calls", () => {
    renderWith(
      <DiffView
        items={[firstItem]}
        callersOf={() => callers.filter((caller) => caller.test)}
        onFollow={() => {}}
      />,
    );
    expect(screen.getByText("Called from").parentElement?.textContent).toBe("Called from 2 tests");
  });
});

describe("shortPaths", () => {
  it("keeps as many directories as it takes to tell paths apart", () => {
    expect(
      shortPaths([
        "a/routes/hosting.py",
        "a/domain/hosting.py",
        "web/setup.tsx",
        "x/a/b.ts",
        "y/a/b.ts",
      ]),
    ).toEqual(["routes/hosting.py", "domain/hosting.py", "setup.tsx", "x/a/b.ts", "y/a/b.ts"]);
    expect(shortPaths(["same.ts", "same.ts"])).toEqual(["same.ts", "same.ts"]);
  });
});

describe("marks in a line", () => {
  it("wraps the marked characters, across tokens, and leaves the rest", () => {
    const { container } = renderWith(
      <HunkCard
        hunk={firstItem.hunk}
        file={orders}
        risk={null}
        inLine={
          new Map([
            [13, [{ start: 2, end: 10, render: (code) => <mark data-testid="mark">{code}</mark> }]],
          ])
        }
      />,
    );
    expect(screen.getByTestId("mark").textContent).toBe("res.json");
    const added = container.querySelector(".line-add .line-code");
    expect(added?.textContent).toBe("  res.json({ items: orders.map(toResponse) });");
  });
});
