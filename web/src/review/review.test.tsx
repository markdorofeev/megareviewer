import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modifiedFile } from "./diff/testing.ts";
import {
  DiffViewer,
  FilePath,
  FileTree,
  KeyHint,
  ReviewSubmitPanel,
  type ViewLine,
} from "./index.ts";

const FILE = modifiedFile("src/retry.ts", [
  "@@ -10,4 +10,4 @@ export function retry",
  " a",
  "-b",
  "+B",
  " c",
  " d",
]);

beforeEach(() => {
  // jsdom has no layout, so nothing scrolls.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("DiffViewer", () => {
  it("labels every changed line for screen readers, not only by color", () => {
    render(<DiffViewer file={FILE} virtualize={false} />);
    const grid = screen.getByRole("grid", { name: "Diff of src/retry.ts" });
    expect(within(grid).getByText(/removed line 11/)).toBeTruthy();
    expect(within(grid).getByText(/added line 11/)).toBeTruthy();
    expect(within(grid).getByText(/Hunk 1 of 1, lines 10 to 13/)).toBeTruthy();
  });

  it("moves the line focus with the arrows and comments on the selection with c", () => {
    const comments: (readonly ViewLine[])[] = [];
    render(
      <DiffViewer file={FILE} virtualize={false} onComment={(lines) => comments.push(lines)} />,
    );
    const grid = screen.getByRole("grid");
    act(() => grid.focus());
    const active = () => document.getElementById(grid.getAttribute("aria-activedescendant") ?? "");
    expect(active()?.textContent).toContain("unchanged line 10");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(active()?.textContent).toContain("removed line 11");
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    expect(grid.querySelectorAll("[aria-selected=true]")).toHaveLength(2);
    fireEvent.keyDown(grid, { key: "c" });
    expect(comments[0]?.map((line) => line.text)).toEqual(["b", "B"]);
  });

  it("shows split halves side by side", () => {
    render(<DiffViewer file={FILE} view="split" virtualize={false} />);
    const old = screen.getByText(/removed line 11/).closest("[role=row]");
    const added = screen.getByText(/added line 11/).closest("[role=row]");
    expect(old?.parentElement).toBe(added?.parentElement);
  });

  it("waits for a click before drawing a deferred file", () => {
    render(<DiffViewer file={FILE} deferred="Generated file" />);
    expect(screen.queryByRole("grid")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load diff" }));
    expect(screen.getByRole("grid")).toBeTruthy();
  });
});

describe("FileTree", () => {
  const files = [
    {
      path: "src/http/retry.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      threads: 2,
      points: { finding: 2, risk: 1, decision: 3 },
    },
    { path: "src/auth/session.ts", status: "deleted", additions: 0, deletions: 9 },
    { path: "src/http/backoff.ts", status: "added", additions: 7, deletions: 0 },
    {
      path: "src/util/sleep.ts",
      oldPath: "src/util/wait.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
    },
  ] as const;
  const row = (path: string) => {
    const one = screen.getAllByRole("treeitem").find((item) => item.dataset.key === path);
    if (one === undefined) throw new Error(`no row for ${path}`);
    return one;
  };

  it("filters with / and clears with Esc", () => {
    render(<FileTree files={files} activePath={null} onSelect={() => undefined} />);
    fireEvent.keyDown(window, { key: "/" });
    const filter = screen.getByRole("textbox", { name: "Filter files by name or path" });
    expect(document.activeElement).toBe(filter);
    fireEvent.change(filter, { target: { value: "auth" } });
    expect(screen.getByText("1 of 4 files")).toBeTruthy();
    expect(
      screen.getAllByRole("treeitem").some((item) => item.dataset.key === "src/http/retry.ts"),
    ).toBe(false);
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(screen.getByText("4 files")).toBeTruthy();
  });

  it("narrows to the files with findings or risks, counting them", () => {
    render(<FileTree files={files} activePath={null} onSelect={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Findings 1" }));
    expect(screen.getByText("1 of 4 files")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Findings 1" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("4 files")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "auth" } });
    fireEvent.click(screen.getByRole("button", { name: "Risks 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByText("4 files")).toBeTruthy();
  });

  it("says each file's status and marks in words, and shows its status on its name", () => {
    render(<FileTree files={files} activePath="src/http/retry.ts" onSelect={() => undefined} />);
    const modified = row("src/http/retry.ts");
    expect(modified.getAttribute("aria-label")).toBe(
      "retry.ts, TypeScript, modified, 1 line added, 1 line removed, 2 open threads, 2 findings, 1 risk, in src/http",
    );
    expect(modified.getAttribute("aria-selected")).toBe("true");
    expect(modified.querySelector("[data-slot=file-stem]")?.className).toBe("");
    expect(modified.querySelector("[data-kind=finding]")?.textContent).toBe("2");
    expect(modified.querySelector("[data-kind=risk]")?.textContent).toBe("");
    expect(modified.querySelector("[data-kind=decision]")).toBeNull();

    const added = row("src/http/backoff.ts");
    expect(added.querySelector("[data-slot=file-stem]")?.className).toContain("text-diff-add-fg");
    expect(added.querySelector("[data-slot=file-extension]")?.className).toContain(
      "text-file-ext-add",
    );
    expect(added.textContent).toBe("backoff.ts+7");

    const deleted = row("src/auth/session.ts");
    expect(deleted.getAttribute("aria-label")).toContain("TypeScript, deleted");
    expect(deleted.querySelector("[data-slot=file-stem]")?.className).toContain("line-through");
    expect(deleted.textContent).toBe("session.ts−9");

    const renamed = row("src/util/sleep.ts");
    expect(renamed.title).toBe("src/util/sleep.ts\nRenamed · was wait.ts");
    expect(renamed.getAttribute("aria-label")).toContain("renamed from src/util/wait.ts");
    expect(renamed.textContent).toBe("sleep.ts");
  });

  it("shows each file's type by IntelliJ IDEA's icon, in both themes", () => {
    render(
      <FileTree
        files={[
          { path: "src/A.java", status: "modified", additions: 1, deletions: 0 },
          { path: "src/test/java/ATest.java", status: "added", additions: 1, deletions: 0 },
        ]}
        activePath={null}
        onSelect={() => undefined}
      />,
    );
    const icon = row("src/A.java").querySelector("[data-icon]");
    expect(icon?.getAttribute("data-icon")).toBe("class");
    // The light variant, then the dark one, which only the dark theme shows.
    const [light, dark] = [...(icon?.querySelectorAll("img") ?? [])];
    expect(light?.getAttribute("src")).toContain("E7EFFD");
    expect(dark?.getAttribute("src")).toContain("25324D");
    expect(dark?.className).toContain("dark:block");
    expect(row("src/test/java/ATest.java").querySelector("[data-test-mark]")).not.toBeNull();
  });
});

describe("FilePath", () => {
  const nameOf = (container: HTMLElement) =>
    container.querySelector("[data-slot=file-name]")?.className ?? "";

  it("marks a new file's name in the add color, with a hidden word", () => {
    const { container } = render(
      <FilePath file={{ path: "src/http/backoff.ts", oldPath: null }} status="added" />,
    );
    expect(nameOf(container)).toContain("text-diff-add-fg");
    expect(container.querySelector(".sr-only")?.textContent).toBe(", new");
    // Only the name is colored; the directory stays muted.
    expect(container.querySelector(".text-muted-foreground")?.textContent).toBe("src/http/");
  });

  it("marks a deleted file's name struck through", () => {
    const { container } = render(
      <FilePath file={{ path: "src/auth/session.ts", oldPath: null }} status="deleted" />,
    );
    expect(nameOf(container)).toContain("text-diff-del-fg");
    expect(nameOf(container)).toContain("line-through");
    expect(container.querySelector(".sr-only")?.textContent).toBe(", deleted");
  });

  it("puts the file type's icon before every path", () => {
    const { container } = render(
      <>
        <FilePath file={{ path: "src/http/retry.ts", oldPath: null }} status="modified" />
        <FilePath file={{ path: "src/Sleep.java", oldPath: "src/Wait.java" }} status="renamed" />
      </>,
    );
    expect(
      [...container.querySelectorAll("[data-icon]")].map((icon) => icon.getAttribute("data-icon")),
    ).toEqual(["typeScript", "class"]);
  });
});

describe("KeyHint", () => {
  it("hides a letter key's hint when single-key shortcuts are off, not ⌘↵'s", () => {
    window.localStorage.setItem("megareviewer:singleKeyShortcuts", "false");
    const { container } = render(
      <>
        <KeyHint id="nextFile" />
        <KeyHint id="submit" />
      </>,
    );
    expect(container.querySelectorAll("[data-slot=kbd-group]")).toHaveLength(1);
  });
});

describe("ReviewSubmitPanel", () => {
  it("offers only a comment on the author's own PR", () => {
    render(
      <ReviewSubmitPanel
        pending={[]}
        decided={[0, 1]}
        canApprove={false}
        onSubmit={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Publish/ }));
    expect(screen.getAllByText("Not on your own pull request.")).toHaveLength(2);
  });
});
