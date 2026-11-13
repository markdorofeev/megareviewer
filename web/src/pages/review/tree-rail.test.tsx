import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "../../review/index.ts";
import { byTreePath, fileTree, type TreeEntry, treeOrder } from "../../review/tree/paths.ts";
import { fileInView } from "./useFileInView.ts";

// delphi-code #2's code files: two hosting_services.py, a chain web/src/, files at the top level.
const paths = [
  "delphi_code/domain/hosting_services.py",
  "delphi_code/http_api/app.py",
  "delphi_code/http_api/routes/hosting_services.py",
  "delphi_code/infrastructure/keychain.py",
  "web/src/routes/setup.tsx",
  "web/src/setup/ConnectionsSection.tsx",
  "CONTRIBUTING.md",
];
const tree = fileTree(paths);

/** Headings and file names, indented by depth: the tree as the rail draws it. */
const outline = (entries: readonly TreeEntry[], depth = 0): string[] =>
  entries.flatMap((entry) =>
    entry.kind === "file"
      ? [`${"  ".repeat(depth)}${entry.name}`]
      : [`${"  ".repeat(depth)}${entry.label}`, ...outline(entry.children, depth + 1)],
  );

describe("fileTree", () => {
  it("nests files under their directories, one heading for a chain", () => {
    expect(outline(tree)).toEqual([
      "delphi_code/",
      "  domain/",
      "    hosting_services.py",
      "  http_api/",
      "    routes/",
      "      hosting_services.py",
      "    app.py",
      "  infrastructure/",
      "    keychain.py",
      "web/src/",
      "  routes/",
      "    setup.tsx",
      "  setup/",
      "    ConnectionsSection.tsx",
      "CONTRIBUTING.md",
    ]);
  });

  it("collapses a chain only while its directories hold no files and one directory", () => {
    const deep = fileTree(["a/b/c/one.ts", "a/b/two.ts", "x/y/z/three.ts"]);
    expect(outline(deep)).toEqual([
      "a/b/",
      "  c/",
      "    one.ts",
      "  two.ts",
      "x/y/z/",
      "  three.ts",
    ]);
  });

  it("lists the files in the order the page shows them, whatever order they came in", () => {
    const order = treeOrder(fileTree([...paths].reverse()));
    expect(order).toEqual([...paths].sort(byTreePath));
    expect(order.indexOf("delphi_code/http_api/routes/hosting_services.py")).toBeLessThan(
      order.indexOf("delphi_code/http_api/app.py"),
    );
  });
});

/** File rows only: directory headings are buttons too, titled with a trailing slash. */
const row = (name: string, at = 0): HTMLElement => {
  const found = screen
    .getAllByRole("button")
    .filter((button) => !button.title.endsWith("/") && button.title.endsWith(name));
  const one = found[at];
  if (one === undefined) throw new Error(`no row for ${name}`);
  return one;
};

const entries = paths.map((path) => ({
  path,
  status: "modified" as const,
  additions: 1,
  deletions: 0,
}));

const renderRail = (current: string | null, onGo = vi.fn()) =>
  render(<FileTree files={entries} activePath={current} onSelect={onGo} />);

describe("FileTree as the rail", () => {
  it("shows directory headings, a row per file, and no contract counts", () => {
    renderRail(null);
    const rail = screen.getByRole("navigation", { name: "Changed files" });
    expect(within(rail).getByText("web/src/")).toBeTruthy();
    expect(
      within(rail)
        .getAllByRole("button")
        .filter((button) => !button.title.endsWith("/")),
    ).toHaveLength(paths.length);
    expect(row("routes/hosting_services.py").textContent).not.toContain("contract");
    expect(within(rail).getByTitle("delphi_code/").textContent).toBe("delphi_code/");
  });

  it("highlights the file in view and only it", () => {
    renderRail("delphi_code/http_api/routes/hosting_services.py");
    expect(row("routes/hosting_services.py").getAttribute("aria-current")).toBe("location");
    for (const name of ["app.py", "domain/hosting_services.py", "CONTRIBUTING.md"]) {
      expect(row(name).getAttribute("aria-current")).toBeNull();
    }
  });

  it("opens the directories down to the file that comes into view, and leaves the others closed", async () => {
    const { rerender } = renderRail("CONTRIBUTING.md");
    await userEvent.click(screen.getByTitle("delphi_code/"));
    await userEvent.click(screen.getByTitle("web/src/"));
    expect(screen.queryByTitle("delphi_code/http_api/")).toBeNull();

    rerender(
      <FileTree
        files={entries}
        activePath="delphi_code/http_api/routes/hosting_services.py"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTitle("delphi_code/").getAttribute("aria-expanded")).toBe("true");
    expect(row("routes/hosting_services.py").getAttribute("aria-current")).toBe("location");
    expect(screen.getByTitle("web/src/").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps closed the directory of the file in view when the reviewer closes it", async () => {
    renderRail("delphi_code/infrastructure/keychain.py");
    await userEvent.click(screen.getByTitle("delphi_code/infrastructure/"));
    expect(screen.getByTitle("delphi_code/infrastructure/").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.queryByTitle("delphi_code/infrastructure/keychain.py")).toBeNull();
  });

  it("goes to a file's card on a click", async () => {
    const onGo = vi.fn();
    renderRail(null, onGo);
    await userEvent.click(row("keychain.py"));
    expect(onGo).toHaveBeenCalledWith("delphi_code/infrastructure/keychain.py");
  });
});

describe("fileInView", () => {
  const cards = [
    { path: "a.py", top: -900 },
    { path: "b.py", top: -100 },
    { path: "c.py", top: 150 },
    { path: "d.py", top: 600 },
  ];

  it("is the last card whose top has passed a quarter of the window", () => {
    expect(fileInView(cards, 800, false)).toBe("c.py");
    expect(fileInView(cards, 400, false)).toBe("b.py");
  });

  it("is the first card before any has reached that line", () => {
    expect(fileInView([{ path: "a.py", top: 300 }], 800, false)).toBe("a.py");
    expect(fileInView([], 800, false)).toBeNull();
  });

  it("is the last card on screen once the page is scrolled to the bottom", () => {
    expect(fileInView(cards, 800, true)).toBe("d.py");
  });
});
