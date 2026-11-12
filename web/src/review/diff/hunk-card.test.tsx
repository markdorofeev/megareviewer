import { fireEvent, render, screen, within } from "@testing-library/react";
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
  it("shows the file, the section heading, its counts and its risk in the header, and no status for a modified file", () => {
    renderWith(<Cards />);
    const header = screen.getByRole("region", { name: firstName }).querySelector("header");
    expect(header?.textContent).toBe(
      "src/routes/orders.tsexport const ordersRouter = Router();+1 −1▲Contract: Changes the response shape.",
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

  it("shows no risk on a part of a file's card", () => {
    renderWith(<Cards inFile />);
    const part = screen.getByRole("region", { name: firstName });
    expect(part.querySelector("[data-slot=part-risk]")).toBeNull();
    expect(part.textContent).not.toContain("contract");
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

  it("opens a comment with a click anywhere on a line, but not when selecting code", async () => {
    const user = userEvent.setup();
    const onOpenComment = vi.fn();
    renderWith(<Cards cards={[second]} onOpenComment={onOpenComment} onComment={vi.fn()} />);
    const row = screen.getAllByRole("row").find((one) => one.dataset.kind === "add");
    if (row === undefined) throw new Error("no added line");
    await user.click(row);
    expect(onOpenComment).toHaveBeenLastCalledWith(second.hunk.id, { side: "new", line: 41 });
    onOpenComment.mockClear();
    const selection = window.getSelection();
    selection?.selectAllChildren(row);
    // A click that ends a drag over the code: the selection is still there.
    fireEvent.click(row);
    expect(onOpenComment).not.toHaveBeenCalled();
    selection?.removeAllRanges();
  });

  it("closes the open comment box with a click on its own line, Cancel or Esc", async () => {
    const user = userEvent.setup();
    const onOpenComment = vi.fn();
    renderWith(
      <Cards
        cards={[second]}
        openComment={{ side: "new", line: 41 }}
        onOpenComment={onOpenComment}
        onComment={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Comment on line 41" }));
    expect(onOpenComment).toHaveBeenLastCalledWith(second.hunk.id, null);
    expect(onOpenComment).not.toHaveBeenCalledWith(second.hunk.id, { side: "new", line: 41 });
    onOpenComment.mockClear();
    await user.click(screen.getByRole("button", { name: /^Cancel/ }));
    expect(onOpenComment).toHaveBeenCalledWith(second.hunk.id, null);
    onOpenComment.mockClear();
    screen.getByRole("textbox", { name: "Comment on line 41" }).focus();
    await user.keyboard("{Escape}");
    expect(onOpenComment).toHaveBeenCalledWith(second.hunk.id, null);
  });

  const draft = { side: "new" as const, line: 41, body: "Name it `count`." };

  it("stays open when the focus leaves it, so the reviewer can select code", async () => {
    const user = userEvent.setup();
    const onOpenComment = vi.fn();
    renderWith(
      <Cards
        cards={[second]}
        comments={[draft]}
        openComment={draft}
        onOpenComment={onOpenComment}
        onComment={vi.fn()}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Comment on line 41" });
    await user.click(field);
    const header = screen.getByRole("region").querySelector("header");
    if (header === null) throw new Error("no header");
    await user.click(header);
    expect(document.activeElement).not.toBe(field);
    expect(onOpenComment).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Comment on line 41" })).toBeTruthy();
  });

  it("shows a draft as a comment once it's added, with Edit and Discard", async () => {
    const user = userEvent.setup();
    const onOpenComment = vi.fn();
    const onComment = vi.fn();
    const comment = { ...draft, severity: "major" as const, suggestion: ["count"] };
    const props = { cards: [second], comments: [comment], onOpenComment, onComment };
    const { rerender } = renderWith(<Cards {...props} openComment={comment} />);
    expect(
      screen.getByRole("textbox", { name: "Comment on line 41" }).getAttribute("placeholder"),
    ).toBe("Leave a comment");
    await user.click(screen.getByRole("button", { name: /^Add to review/ }));
    expect(onOpenComment).toHaveBeenLastCalledWith(second.hunk.id, null);
    expect(onComment).not.toHaveBeenCalled();

    rerender(
      <HighlighterContext.Provider value={pendingHighlighter()}>
        <Cards {...props} openComment={null} />
      </HighlighterContext.Provider>,
    );
    const saved = document.querySelector<HTMLElement>("[data-slot=line-comment]");
    if (saved === null) throw new Error("no draft");
    expect(within(saved).queryByRole("textbox")).toBeNull();
    expect(within(saved).getByText("Draft · posts with your review")).toBeTruthy();
    expect(saved.querySelector("[data-slot=severity]")?.textContent).toBe("▲major");
    expect(saved.querySelector("[data-slot=thread-body]")?.textContent).toBe("Name it count.");
    expect(saved.querySelector("[data-kind=del]")?.textContent).toContain("b");
    expect(saved.querySelector("[data-kind=add]")?.textContent).toContain("count");

    await user.click(within(saved).getByRole("button", { name: "Edit" }));
    expect(onOpenComment).toHaveBeenLastCalledWith(second.hunk.id, { side: "new", line: 41 });
    rerender(
      <HighlighterContext.Provider value={pendingHighlighter()}>
        <Cards {...props} openComment={comment} />
      </HighlighterContext.Provider>,
    );
    const field = screen.getByRole("textbox", { name: "Comment on line 41" });
    expect((field as HTMLTextAreaElement).value).toBe("Name it `count`.");
    expect(document.activeElement).toBe(field);
  });

  it("removes a saved draft with Discard, and has no Discard while editing", async () => {
    const user = userEvent.setup();
    const onComment = vi.fn();
    const props = { cards: [second], comments: [draft], onOpenComment: vi.fn(), onComment };
    const { rerender } = renderWith(<Cards {...props} />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(onComment).toHaveBeenLastCalledWith(second.hunk.id, { side: "new", line: 41, body: "" });
    rerender(
      <HighlighterContext.Provider value={pendingHighlighter()}>
        <Cards {...props} openComment={draft} />
      </HighlighterContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  });

  it("puts back the draft as it was when the box opened on Cancel or Esc", async () => {
    const user = userEvent.setup();
    const onOpenComment = vi.fn();
    const onComment = vi.fn();
    const props = { cards: [second], onOpenComment, onComment };
    const edited = { ...draft, body: "Name it `total`." };
    // Opened on a saved draft, then edited: Cancel brings back the saved text.
    const { rerender } = renderWith(<Cards {...props} comments={[draft]} openComment={draft} />);
    rerender(<Cards {...props} comments={[edited]} openComment={draft} />);
    await user.click(screen.getByRole("button", { name: /^Cancel/ }));
    expect(onComment).toHaveBeenLastCalledWith(second.hunk.id, draft);
    expect(onOpenComment).toHaveBeenLastCalledWith(second.hunk.id, null);

    // Opened on a line with no draft: Esc removes what was typed.
    const place = { side: "new" as const, line: 42 };
    rerender(<Cards {...props} comments={[]} openComment={place} />);
    rerender(<Cards {...props} comments={[{ ...place, body: "Typed" }]} openComment={place} />);
    screen.getByRole("textbox", { name: "Comment on line 42" }).focus();
    await user.keyboard("{Escape}");
    expect(onComment).toHaveBeenLastCalledWith(second.hunk.id, { ...place, body: "" });
  });

  it("removes a draft with no text when it's added", async () => {
    const user = userEvent.setup();
    const onComment = vi.fn();
    const empty = { ...draft, body: "  ", severity: "minor" as const };
    renderWith(
      <Cards
        cards={[second]}
        comments={[empty]}
        openComment={empty}
        onOpenComment={vi.fn()}
        onComment={onComment}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Add to review/ }));
    expect(onComment).toHaveBeenLastCalledWith(second.hunk.id, { side: "new", line: 41, body: "" });
  });

  it("extends the open comment into a range with ⇧-click on the same side", async () => {
    const user = userEvent.setup();
    const onOpenComment = vi.fn();
    renderWith(
      <Cards
        cards={[second]}
        openComment={{ side: "new", line: 40 }}
        onOpenComment={onOpenComment}
        onComment={vi.fn()}
      />,
    );
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: "Comment on line 42" }));
    await user.keyboard("{/Shift}");
    expect(onOpenComment).toHaveBeenLastCalledWith(second.hunk.id, {
      side: "new",
      line: 42,
      startLine: 40,
    });
  });

  it("gives the comment box no severity picker or suggestion editor, and keeps a draft's from before", async () => {
    const user = userEvent.setup();
    const onComment = vi.fn();
    const comment = { side: "new" as const, line: 42, startLine: 40, body: "Simplify" };
    renderWith(
      <Cards
        cards={[second]}
        comments={[{ ...comment, severity: "minor", suggestion: ["a"] }]}
        openComment={comment}
        onOpenComment={vi.fn()}
        onComment={onComment}
        rangeNote="Bitbucket can't anchor a range."
      />,
    );
    expect(screen.getByText(/Bitbucket can't anchor a range/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Severity" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(minor|major|blocking)$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Suggest a change" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Suggested lines" })).toBeNull();
    // A draft written before the controls went keeps its severity and suggestion as its text changes.
    await user.type(screen.getByRole("textbox", { name: "Comment on lines 40–42" }), "!");
    expect(onComment).toHaveBeenLastCalledWith(second.hunk.id, {
      ...comment,
      body: "Simplify!",
      severity: "minor",
      suggestion: ["a"],
    });
  });

  it("heads the comment box with its file and lines, and marks the lines it's on", () => {
    const comment = { side: "new" as const, line: 42, startLine: 41 };
    renderWith(
      <Cards cards={[second]} openComment={comment} onOpenComment={vi.fn()} onComment={vi.fn()} />,
    );
    const box = document.querySelector<HTMLElement>("[data-slot=line-comment]");
    if (box === null) throw new Error("no box");
    expect(within(box).getByText(/^Commenting on/).textContent).toBe(
      "Commenting on orders.tslines R41–42",
    );
    expect(box.querySelector("[data-slot=key-hint-line]")?.textContent).toBe(
      "Ctrl↵add to review·Esccancel",
    );
    const marked = [...document.querySelectorAll<HTMLElement>("[data-marked]")];
    // The new side's number, the row's second cell.
    expect(marked.map((row) => row.children[1]?.textContent)).toEqual(["41", "42"]);
  });

  it("previews the comment as it will read, and adds it from there with ⌘↵", async () => {
    const user = userEvent.setup();
    const onOpenComment = vi.fn();
    const comment = { side: "new" as const, line: 41, body: "Name it `count`." };
    renderWith(
      <Cards
        cards={[second]}
        comments={[comment]}
        openComment={comment}
        onOpenComment={onOpenComment}
        onComment={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    const preview = document.querySelector("[data-slot=comment-preview]");
    expect(preview?.querySelector("code")?.textContent).toBe("count");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onOpenComment).toHaveBeenLastCalledWith(second.hunk.id, null);
  });

  it("posts a comment now, and removes the draft once it's posted", async () => {
    const user = userEvent.setup();
    const onOpenComment = vi.fn();
    const onComment = vi.fn();
    const onCommentNow = vi.fn(async () => null);
    const comment = { side: "new" as const, line: 41, body: "Why 600?" };
    renderWith(
      <Cards
        cards={[second]}
        comments={[comment]}
        openComment={comment}
        onOpenComment={onOpenComment}
        onComment={onComment}
        onCommentNow={onCommentNow}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Comment now" }));
    expect(onCommentNow).toHaveBeenCalledWith(second.hunk.id, comment);
    await vi.waitFor(() =>
      expect(onComment).toHaveBeenLastCalledWith(second.hunk.id, {
        side: "new",
        line: 41,
        body: "",
      }),
    );
    expect(onOpenComment).toHaveBeenLastCalledWith(second.hunk.id, null);
  });

  it("keeps the text and says why when posting now fails, and has no Comment now without it", async () => {
    const user = userEvent.setup();
    const onComment = vi.fn();
    const comment = { side: "new" as const, line: 41, body: "Why 600?" };
    const props = {
      cards: [second],
      comments: [comment],
      openComment: comment,
      onOpenComment: vi.fn(),
      onComment,
    };
    const { rerender } = renderWith(
      <Cards {...props} onCommentNow={async () => "The pull request has new commits."} />,
    );
    await user.click(screen.getByRole("button", { name: "Comment now" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Not posted: The pull request has new commits.",
    );
    expect(onComment).not.toHaveBeenCalled();
    rerender(<Cards {...props} />);
    expect(screen.queryByRole("button", { name: "Comment now" })).toBeNull();
  });

  it("puts the host's threads under the line they're on", () => {
    renderWith(
      <Cards
        cards={[second]}
        threadsAt={(place) => (place.line === 41 ? <p>A thread</p> : null)}
      />,
    );
    const rows = screen.getAllByRole("row");
    const at = rows.findIndex((row) => row.textContent === "A thread");
    expect(rows[at - 1]?.textContent).toContain("b");
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

  it("marks a new file's header by its icon and name, with no chip", () => {
    const [file] = parseFiles([
      "diff --git a/src/backoff.ts b/src/backoff.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/backoff.ts",
      "@@ -0,0 +1 @@",
      "+a",
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
    const header = screen.getByRole("region").querySelector("header");
    expect(header?.querySelector("svg[data-status=added]")).not.toBeNull();
    expect(header?.querySelector("[data-slot=file-status]")).toBeNull();
    expect(header?.textContent).toMatch(/^src\/backoff\.ts, new/);
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
      /^src\/token\.ts →renamed to src\/credentials\.tsrenamed/,
    );
  });
});
