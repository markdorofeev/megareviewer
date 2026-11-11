import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ReviewThread } from "../../../../src/domain/review/index.ts";
import { type Highlighter, HighlighterContext } from "../diff/syntax.ts";
import { initialsOf, relativeTime } from "./people.ts";
import { type ReviewThreadProps, ReviewThreadView } from "./review-thread.tsx";

const pending: Highlighter = { highlight: () => new Promise(() => {}) };
const NOW = Date.parse("2026-10-21T10:00:00Z");
const sam = { id: "sam", name: "Sam Ortiz" };
const dana = { id: "dana", name: "Dana Kim" };

const thread = (fields: Partial<ReviewThread> = {}): ReviewThread => ({
  id: "PRRT_1",
  path: "src/a.ts",
  side: "new",
  line: 4,
  startLine: null,
  originalLine: 4,
  resolved: false,
  resolvedBy: null,
  outdated: false,
  can: { reply: true, resolve: true },
  comments: [
    {
      id: "c1",
      author: sam,
      body: "**major:** Cache never evicts.",
      createdAt: "2026-10-21T09:55:00Z",
      originalCommit: null,
    },
    {
      id: "c2",
      author: dana,
      body: "Capped it.",
      createdAt: "2026-10-21T07:00:00Z",
      originalCommit: null,
    },
  ],
  ...fields,
});

const suggesting = thread({
  comments: [
    {
      id: "s1",
      author: sam,
      body: "Rename:\n\n```suggestion\nconst MAX = 3;\n```",
      createdAt: "2026-10-21T09:00:00Z",
      originalCommit: null,
    },
  ],
});

const show = (props: Partial<ReviewThreadProps> = {}) => {
  const handlers = {
    onReply: vi.fn(async (_body: string): Promise<string | null> => null),
    onResolve: vi.fn(async (_resolved: boolean): Promise<string | null> => null),
    onAddToBatch: vi.fn(),
    onRemoveFromBatch: vi.fn(),
    onApply: vi.fn(),
  };
  const ui = (extra: Partial<ReviewThreadProps>): ReactNode => (
    <HighlighterContext.Provider value={pending}>
      <ReviewThreadView
        thread={thread()}
        authorId="dana"
        now={NOW}
        language="typescript"
        covered={["const attempts = 3;"]}
        canApply
        batch={{ has: () => false, problem: () => null }}
        {...handlers}
        {...props}
        {...extra}
      />
    </HighlighterContext.Provider>
  );
  const view = render(ui({}));
  return { ...handlers, rerender: (extra: Partial<ReviewThreadProps>) => view.rerender(ui(extra)) };
};

describe("ReviewThreadView", () => {
  it("shows each comment's author, Author chip, time and severity, replies after a rule", () => {
    show();
    const article = screen.getByRole("article", { name: "Thread on line 4" });
    expect(article.dataset.state).toBe("open");
    const comments = within(article).getAllByText(/Sam Ortiz|Dana Kim/);
    expect(comments.map((one) => one.textContent)).toEqual(["Sam Ortiz", "Dana Kim"]);
    expect(within(article).getByText("Author")).toBeTruthy();
    expect(within(article).getByText("5 min ago")).toBeTruthy();
    expect(within(article).getByText("3 h ago")).toBeTruthy();
    expect(article.querySelector("[data-slot=severity]")?.textContent).toBe("▲major");
    expect(within(article).getByText("Cache never evicts.")).toBeTruthy();
    expect(article.querySelector("[data-slot=thread-replies]")?.textContent).toContain(
      "Capped it.",
    );
  });

  it("renders HTML and links in a body as text", () => {
    show({
      thread: thread({
        comments: [
          {
            id: "x",
            author: sam,
            body: '<script>alert(1)</script> [click](javascript:alert(1)) <img src=x onerror="alert(1)">',
            createdAt: "2026-10-21T09:00:00Z",
            originalCommit: null,
          },
        ],
      }),
    });
    const article = screen.getByRole("article");
    expect(article.querySelector("script, a, img")).toBeNull();
    expect(article.textContent).toContain("<script>alert(1)</script>");
    expect(article.textContent).toContain("[click](javascript:alert(1))");
  });

  it("replies with ⌘↵, keeping the text when posting fails", async () => {
    const { onReply } = show();
    onReply.mockResolvedValueOnce("GitHub answered 502.");
    const field = screen.getByRole("textbox", { name: "Reply to the thread on line 4" });
    await userEvent.type(field, "On it");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onReply).toHaveBeenCalledWith("On it");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Not sent: GitHub answered 502.",
    );
    expect((field as HTMLTextAreaElement).value).toBe("On it");
    await userEvent.click(screen.getByRole("button", { name: /^Reply/ }));
    expect((field as HTMLTextAreaElement).value).toBe("");
  });

  it("shows a reply that's posting", async () => {
    let finish: (value: string | null) => void = () => {};
    const { onReply } = show();
    onReply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await userEvent.type(screen.getByRole("textbox"), "Sure");
    await userEvent.click(screen.getByRole("button", { name: /^Reply/ }));
    expect((screen.getByRole("button", { name: /^Sending/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    finish(null);
    expect(await screen.findByRole("button", { name: /^Reply/ })).toBeTruthy();
  });

  it("takes r, e and b while the focus is in the thread", async () => {
    const { onResolve, onAddToBatch } = show({ thread: suggesting });
    const article = screen.getByRole("article");
    article.focus();
    await userEvent.keyboard("r");
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: /^Reply to the thread/ }),
    );
    article.focus();
    await userEvent.keyboard("e");
    expect(onResolve).toHaveBeenCalledWith(true);
    article.focus();
    await userEvent.keyboard("b");
    expect(onAddToBatch).toHaveBeenCalledWith("s1");
  });

  it("doesn't take a letter typed in the reply field", async () => {
    const { onResolve } = show();
    await userEvent.type(screen.getByRole("textbox"), "e");
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("folds a resolved thread to one line saying who resolved it, and reopens", async () => {
    const { onResolve } = show({ thread: thread({ resolved: true, resolvedBy: dana }) });
    const article = screen.getByRole("article", { name: "Thread on line 4, resolved" });
    expect(article.dataset.state).toBe("resolved");
    expect(within(article).getByText(/Resolved by Dana Kim/)).toBeTruthy();
    expect(within(article).getByText("Sam Ortiz: Cache never evicts.")).toBeTruthy();
    expect(within(article).queryByRole("textbox")).toBeNull();
    await userEvent.click(within(article).getByRole("button", { name: "Show 2 comments" }));
    await userEvent.click(within(article).getByRole("button", { name: /^Reopen/ }));
    expect(onResolve).toHaveBeenCalledWith(false);
  });

  it("says when a resolve fails", async () => {
    const { onResolve } = show();
    onResolve.mockResolvedValueOnce("Not allowed.");
    await userEvent.click(screen.getByRole("button", { name: /^Resolve/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Not resolved: Not allowed.");
  });

  it("marks an outdated thread and offers nothing to apply on it", () => {
    show({ thread: { ...suggesting, outdated: true, line: null } });
    const article = screen.getByRole("article");
    expect(article.dataset.state).toBe("outdated");
    expect(within(article).getByText("Outdated")).toBeTruthy();
    expect(within(article).queryByRole("button", { name: /Apply suggestion/ })).toBeNull();
    // Without the current lines, only what would be added is shown.
    expect(article.querySelectorAll("[data-kind=del]")).toHaveLength(0);
  });

  it("shows a suggestion as a diff of the lines it replaces, with batch and apply", async () => {
    const { onApply, onAddToBatch, rerender, onRemoveFromBatch } = show({ thread: suggesting });
    const diff = document.querySelector("[data-slot=suggestion-diff]");
    expect(diff?.querySelector("[data-kind=del]")?.textContent).toContain("const attempts = 3;");
    expect(diff?.querySelector("[data-kind=add]")?.textContent).toContain("const MAX = 3;");
    await userEvent.click(screen.getByRole("button", { name: "Apply suggestion" }));
    expect(onApply).toHaveBeenCalledWith("s1");
    await userEvent.click(screen.getByRole("button", { name: /^Add to batch/ }));
    expect(onAddToBatch).toHaveBeenCalledWith("s1");
    rerender({ batch: { has: () => true, problem: () => null } });
    await userEvent.click(screen.getByRole("button", { name: /In batch/ }));
    expect(onRemoveFromBatch).toHaveBeenCalledWith("s1");
  });

  it("says why a suggestion can't join the batch", () => {
    show({ thread: suggesting, batch: { has: () => false, problem: () => "Overlaps line 4." } });
    expect(
      (screen.getByRole("button", { name: /^Add to batch/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Overlaps line 4.")).toBeTruthy();
  });

  it("shows a suggestion read-only to someone who can't push", () => {
    show({ thread: suggesting, canApply: false });
    expect(screen.getByText("Suggested change")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Apply|batch/ })).toBeNull();
  });

  it("says an empty suggestion deletes the lines", () => {
    show({
      thread: thread({
        comments: [
          {
            id: "d",
            author: sam,
            body: "```suggestion\n```",
            createdAt: "2026-10-21T09:00:00Z",
            originalCommit: null,
          },
        ],
      }),
    });
    expect(screen.getByText("Deletes the line.")).toBeTruthy();
  });

  it("offers neither reply nor resolve when the host doesn't allow them", () => {
    show({ thread: thread({ can: { reply: false, resolve: false } }) });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Resolve/ })).toBeNull();
  });
});

describe("people", () => {
  it("makes initials from a name", () => {
    expect(initialsOf("Dana Kim")).toBe("DK");
    expect(initialsOf("sindresorhus")).toBe("SI");
    expect(initialsOf("  ")).toBe("?");
    expect(initialsOf("ana-maria silva")).toBe("AM");
  });

  it("says how long ago, then the date", () => {
    expect(relativeTime("2026-10-21T09:59:30Z", NOW)).toBe("just now");
    expect(relativeTime("2026-10-20T09:00:00Z", NOW)).toBe("yesterday");
    expect(relativeTime("2026-10-14T10:00:00Z", NOW)).toBe("7 days ago");
    expect(relativeTime("2026-01-02T10:00:00Z", NOW)).toMatch(/2026/);
  });
});
