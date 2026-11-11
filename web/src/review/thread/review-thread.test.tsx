import { fireEvent, render, screen, within } from "@testing-library/react";
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
  it("shows each comment's author, Author chip, time and severity, with a rule between people", () => {
    show();
    const article = screen.getByRole("article", { name: "Thread on line 4" });
    expect(article.dataset.state).toBe("open");
    const comments = within(article).getAllByText(/Sam Ortiz|Dana Kim/);
    expect(comments.map((one) => one.textContent)).toEqual(["Sam Ortiz", "Dana Kim"]);
    expect(within(article).getByText("Author")).toBeTruthy();
    const time = within(article).getByText("5m ago");
    expect(time.getAttribute("title")).toMatch(/2026/);
    expect(within(article).getByText("3h ago")).toBeTruthy();
    expect(article.querySelector("[data-slot=severity]")?.textContent).toBe("▲major");
    expect(within(article).getByText("Cache never evicts.")).toBeTruthy();
    expect(article.querySelectorAll("[data-slot=thread-divider]")).toHaveLength(1);
  });

  it("gives consecutive comments by one person one header, and a rule only between people", () => {
    const comment = (id: string, author: typeof sam, body: string) => ({
      id,
      author,
      body,
      createdAt: "2026-10-21T09:00:00Z",
      originalCommit: null,
    });
    show({
      thread: thread({
        comments: [
          comment("a", sam, "One."),
          comment("b", sam, "Two."),
          comment("c", dana, "Three."),
          comment("d", dana, "Four."),
        ],
      }),
    });
    const article = screen.getByRole("article");
    const groups = [...article.querySelectorAll("[data-slot=thread-group]")];
    expect(
      groups.map((group) => group.querySelectorAll("[data-slot=thread-comment]").length),
    ).toEqual([2, 2]);
    expect(within(article).getAllByText("Sam Ortiz")).toHaveLength(1);
    expect(within(article).getAllByText("Dana Kim")).toHaveLength(1);
    expect(within(article).getAllByText("Author")).toHaveLength(1);
    expect(article.querySelectorAll("[data-slot=thread-divider]")).toHaveLength(1);
  });

  it("draws no rule in a thread of one comment", () => {
    show({ thread: suggesting });
    expect(document.querySelectorAll("[data-slot=thread-divider]")).toHaveLength(0);
  });

  const actions = () =>
    within(document.querySelector<HTMLElement>("[data-slot=thread-actions]") ?? document.body)
      .getAllByRole("button")
      .map((button) => button.textContent);

  it("puts a single suggestion's Add to batch in the thread's one row of actions", () => {
    show({ thread: suggesting, batch: { has: () => false, problem: () => "Overlaps line 4." } });
    expect(actions()).toEqual(["Replyr", "Add to batchb", "Resolvee"]);
    expect(
      within(
        document.querySelector<HTMLElement>("[data-slot=thread-actions]") ?? document.body,
      ).getByText("Overlaps line 4."),
    ).toBeTruthy();
  });

  it("keeps each suggestion's buttons under it when a thread has several", () => {
    const suggestion = (id: string, line: string) => ({
      id,
      author: sam,
      body: `${"```"}suggestion\n${line}\n${"```"}`,
      createdAt: "2026-10-21T09:00:00Z",
      originalCommit: null,
    });
    show({ thread: thread({ comments: [suggestion("s1", "a"), suggestion("s2", "b")] }) });
    expect(actions()).toEqual(["Replyr", "Resolvee"]);
    expect(screen.getAllByRole("button", { name: /^Add to batch/ })).toHaveLength(2);
  });

  it("opens the reply field with Reply, and closes it with Cancel", async () => {
    show();
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Reply/ }));
    const field = screen.getByRole("textbox", { name: "Reply to the thread on line 4" });
    expect(document.activeElement).toBe(field);
    expect(document.querySelector("[data-slot=thread-actions]")).toBeNull();
    await userEvent.type(field, "Hm");
    await userEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Reply/ }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("textbox")).toBeNull();
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

  const withBody = (body: string) =>
    thread({
      comments: [
        { id: "i", author: sam, body, createdAt: "2026-10-21T09:00:00Z", originalCommit: null },
      ],
    });
  const asset = "https://github.com/user-attachments/assets/771a3d24";
  const mediaUrl = (url: string) => `/api/analyses/a_1/attachment?url=${encodeURIComponent(url)}`;

  it("shows the host's images and videos through the local server", () => {
    show({
      thread: withBody(`with image\n\n<img alt="Screenshot 16 45" src="${asset}" />\n\n${asset}`),
      mediaUrl,
    });
    const article = screen.getByRole("article");
    const image = screen.getByRole("img", { name: "Screenshot 16 45" });
    expect(image.getAttribute("src")).toBe(mediaUrl(asset));
    const video = article.querySelector("video");
    expect(video?.getAttribute("src")).toBe(mediaUrl(asset));
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(article.textContent).not.toContain("<img");
  });

  it("opens an image full screen, and closes it with Esc", async () => {
    show({ thread: withBody(`<img alt="Screenshot" src="${asset}">`), mediaUrl });
    await userEvent.click(screen.getByRole("button", { name: "Open Screenshot full screen" }));
    const viewer = await screen.findByRole("dialog", { name: "Screenshot" });
    expect(within(viewer).getByRole("img", { name: "Screenshot" }).getAttribute("src")).toBe(
      mediaUrl(asset),
    );
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("names an image from anywhere else, and one that fails to load", () => {
    show({
      thread: withBody(
        `<img alt="pixel" src="https://evil.test/p.png"> <img alt="gone" src="${asset}">`,
      ),
      mediaUrl,
    });
    const article = screen.getByRole("article");
    expect(article.querySelectorAll("img")).toHaveLength(1);
    expect(article.querySelector("[data-slot=thread-image]")?.textContent).toContain(
      "Image: pixel",
    );
    const gone = screen.getByRole("img", { name: "gone" });
    fireEvent.error(gone);
    expect(article.querySelectorAll("img")).toHaveLength(0);
    expect(article.textContent).toContain("Image: gone couldn't be loaded");
  });

  it("only names attachments when it has nowhere to load them from", () => {
    show({ thread: withBody(`<img alt="shot" src="${asset}">`) });
    const article = screen.getByRole("article");
    expect(article.querySelector("img")).toBeNull();
    expect(article.querySelector("[data-slot=thread-image]")?.textContent).toContain("Image: shot");
  });

  it("replies with ⌘↵, keeping the field and its text when posting fails", async () => {
    const { onReply } = show();
    onReply.mockResolvedValueOnce("GitHub answered 502.");
    await userEvent.click(screen.getByRole("button", { name: /^Reply/ }));
    const field = screen.getByRole("textbox", { name: "Reply to the thread on line 4" });
    await userEvent.type(field, "On it");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onReply).toHaveBeenCalledWith("On it");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Not sent: GitHub answered 502.",
    );
    expect((field as HTMLTextAreaElement).value).toBe("On it");
    field.blur();
    expect(screen.getByRole("textbox")).toBe(field);
    await userEvent.click(screen.getByRole("button", { name: /^Reply/ }));
    expect(onReply).toHaveBeenCalledTimes(2);
    // Posted: the field gives way to the row again.
    await vi.waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(actions()).toContain("Replyr");
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
    await userEvent.click(screen.getByRole("button", { name: /^Reply/ }));
    await userEvent.type(screen.getByRole("textbox"), "Sure");
    await userEvent.click(screen.getByRole("button", { name: /^Reply/ }));
    expect((screen.getByRole("button", { name: /^Sending/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    finish(null);
    await vi.waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
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
    await userEvent.click(screen.getByRole("button", { name: /^Reply/ }));
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
    expect(within(article).queryByRole("button", { name: /batch/ })).toBeNull();
    // Without the current lines, only what would be added is shown.
    expect(article.querySelectorAll("[data-kind=del]")).toHaveLength(0);
  });

  it("shows a suggestion as a diff of the lines it replaces, with Add to batch", async () => {
    const { onAddToBatch, rerender, onRemoveFromBatch } = show({ thread: suggesting });
    const diff = document.querySelector("[data-slot=suggestion-diff]");
    expect(diff?.querySelector("[data-kind=del]")?.textContent).toContain("const attempts = 3;");
    expect(diff?.querySelector("[data-kind=add]")?.textContent).toContain("const MAX = 3;");
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
    expect(screen.queryByRole("button", { name: /Reply|Resolve/ })).toBeNull();
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
    expect(relativeTime("2026-10-21T09:55:00Z", NOW)).toBe("5m ago");
    expect(relativeTime("2026-10-21T08:00:00Z", NOW)).toBe("2h ago");
    expect(relativeTime("2026-10-20T09:00:00Z", NOW)).toBe("yesterday");
    expect(relativeTime("2026-10-14T10:00:00Z", NOW)).toBe("7 days ago");
    expect(relativeTime("2026-01-02T10:00:00Z", NOW)).toMatch(/2026/);
  });
});
