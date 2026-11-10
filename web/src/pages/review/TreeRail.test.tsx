import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TreeRail } from "./TreeRail.tsx";
import { byTreePath, fileTree, type TreeEntry, treeOrder } from "./tree.ts";
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
const contract: Readonly<Record<string, number>> = {
  "delphi_code/http_api/routes/hosting_services.py": 3,
  "delphi_code/infrastructure/keychain.py": 1,
};
const tree = fileTree(paths, (path) => contract[path] ?? 0);

/** Headings and file names, indented by depth: the tree as the rail draws it. */
const outline = (entries: readonly TreeEntry[], depth = 0): string[] =>
  entries.flatMap((entry) =>
    entry.kind === "file"
      ? [`${"  ".repeat(depth)}${entry.name}${entry.contract > 0 ? ` (${entry.contract})` : ""}`]
      : [
          `${"  ".repeat(depth)}${entry.label}${entry.contract > 0 ? ` (${entry.contract})` : ""}`,
          ...outline(entry.children, depth + 1),
        ],
  );

describe("fileTree", () => {
  it("nests files under their directories, one heading for a chain, with contract totals", () => {
    expect(outline(tree)).toEqual([
      "delphi_code/ (4)",
      "  domain/",
      "    hosting_services.py",
      "  http_api/ (3)",
      "    routes/ (3)",
      "      hosting_services.py (3)",
      "    app.py",
      "  infrastructure/ (1)",
      "    keychain.py (1)",
      "web/src/",
      "  routes/",
      "    setup.tsx",
      "  setup/",
      "    ConnectionsSection.tsx",
      "CONTRIBUTING.md",
    ]);
  });

  it("collapses a chain only while its directories hold no files and one directory", () => {
    const deep = fileTree(["a/b/c/one.ts", "a/b/two.ts", "x/y/z/three.ts"], () => 0);
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
    const order = treeOrder(fileTree([...paths].reverse(), () => 0));
    expect(order).toEqual([...paths].sort(byTreePath));
    expect(order.indexOf("delphi_code/http_api/routes/hosting_services.py")).toBeLessThan(
      order.indexOf("delphi_code/http_api/app.py"),
    );
  });
});

const neighbors = new Map<string, ReadonlySet<string>>([
  // app.py registers the routes, which call the domain and the keychain.
  ["delphi_code/http_api/app.py", new Set(["delphi_code/http_api/routes/hosting_services.py"])],
  [
    "delphi_code/http_api/routes/hosting_services.py",
    new Set(["delphi_code/domain/hosting_services.py", "delphi_code/infrastructure/keychain.py"]),
  ],
]);

const row = (name: string, at = 0): HTMLElement => {
  const found = screen.getAllByRole("button").filter((button) => button.title.endsWith(name));
  const one = found[at];
  if (one === undefined) throw new Error(`no row for ${name}`);
  return one;
};

describe("TreeRail", () => {
  it("shows directory headings with their totals, and a row per file with its contract parts", () => {
    render(<TreeRail tree={tree} current={null} neighbors={neighbors} onGo={() => {}} />);
    const rail = screen.getByRole("navigation", { name: "Changed files" });
    expect(within(rail).getByText("web/src/")).toBeTruthy();
    expect(within(rail).getAllByRole("button")).toHaveLength(paths.length);
    expect(row("routes/hosting_services.py").textContent).toBe("hosting_services.py3 contract");
    expect(row("domain/hosting_services.py").textContent).toBe("hosting_services.py");
    expect(within(rail).getByTitle("delphi_code/").textContent).toBe("delphi_code/4 contract");
  });

  it("highlights the file in view, arrows its callers and callees, and mutes the rest", () => {
    render(
      <TreeRail
        tree={tree}
        current="delphi_code/http_api/routes/hosting_services.py"
        neighbors={neighbors}
        onGo={() => {}}
      />,
    );
    const current = row("routes/hosting_services.py");
    expect(current.getAttribute("aria-current")).toBe("location");
    expect(current.className).toContain("current");
    expect(row("app.py").textContent).toBe("↑calls the file in view, app.py");
    expect(row("domain/hosting_services.py").textContent).toContain("↓called by the file in view");
    expect(row("keychain.py").textContent).toContain("↓");
    for (const name of ["setup.tsx", "ConnectionsSection.tsx", "CONTRIBUTING.md"]) {
      expect(row(name).className).toContain("other");
      expect(row(name).getAttribute("aria-current")).toBeNull();
    }
  });

  it("mutes nothing and draws no arrows without a file in view", () => {
    render(<TreeRail tree={tree} current={null} neighbors={neighbors} onGo={() => {}} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).not.toContain("other");
      expect(button.textContent).not.toMatch(/[↑↓↕]/);
    }
  });

  it("goes to a file's card on a click", async () => {
    const onGo = vi.fn();
    render(<TreeRail tree={tree} current={null} neighbors={neighbors} onGo={onGo} />);
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
