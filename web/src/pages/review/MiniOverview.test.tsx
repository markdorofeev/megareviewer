import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MiniOverview } from "./MiniOverview.tsx";
import {
  fitMiniOverview,
  type MiniOverview as Mini,
  miniLabels,
  miniLists,
} from "./mini-overview.ts";
import type { FileOverview, OverviewNode } from "./overview.ts";
import { Rail } from "./Rail.tsx";

// delphi-code #2's shape: the routes call the domain and the keychain; app.py registers the routes.
const paths = [
  "delphi_code/domain/hosting_services.py",
  "delphi_code/http_api/routes/hosting_services.py",
  "delphi_code/http_api/app.py",
  "delphi_code/infrastructure/keychain.py",
  "web/src/domain/types.ts",
  "CONTRIBUTING.md",
];
const neighbors = new Map<string, ReadonlySet<string>>([
  ["delphi_code/http_api/app.py", new Set(["delphi_code/http_api/routes/hosting_services.py"])],
  [
    "delphi_code/http_api/routes/hosting_services.py",
    new Set([
      "delphi_code/http_api/app.py",
      "delphi_code/domain/hosting_services.py",
      "delphi_code/infrastructure/keychain.py",
    ]),
  ],
]);
const contract: Readonly<Record<string, number>> = { "delphi_code/infrastructure/keychain.py": 1 };
const contractOf = (path: string) => contract[path] ?? 0;

const node = (directory: string, inIt: readonly string[], row: number): OverviewNode => ({
  key: `group:${directory}`,
  kind: "group",
  paths: inIt,
  label: `${directory || "."}/`,
  contract: inIt.reduce((sum, path) => sum + contractOf(path), 0),
  added: 4,
  deleted: 1,
  risk: inIt.some((path) => contractOf(path) > 0) ? "contract" : "logic",
  generated: false,
  entries: [],
  flows: [],
  partIds: [],
  uses: 0,
  badges: [],
  row,
});

const routes = node("delphi_code/http_api/routes", [paths[1] ?? ""], 0);
const api = node("delphi_code/http_api", [paths[2] ?? ""], 1);
const domain = node("delphi_code/domain", [paths[0] ?? ""], 1);
const keychain = node("delphi_code/infrastructure", [paths[3] ?? ""], 1);
const webDomain = node("web/src/domain", [paths[4] ?? ""], -1);
const top = node("", [paths[5] ?? ""], -1);

const overview: FileOverview = {
  rows: [[routes], [api, domain, keychain]],
  edges: [routes, api, domain, keychain].slice(1).map((to) => ({
    from: routes.key,
    to: to.key,
    uses: ["call"],
    symbols: [],
    back: false,
    outside: false,
  })),
  strip: [webDomain, top],
  placeOf: new Map([
    [paths[0] ?? "", domain.key],
    [paths[1] ?? "", routes.key],
    [paths[2] ?? "", api.key],
    [paths[3] ?? "", keychain.key],
    [paths[4] ?? "", webDomain.key],
    [paths[5] ?? "", top.key],
  ]),
};
const mini: Mini = { overview, depth: null };

const show = (current: string | null, more: Partial<Parameters<typeof MiniOverview>[0]> = {}) =>
  render(
    <MiniOverview
      mini={mini}
      paths={paths}
      current={current}
      neighbors={neighbors}
      contractOf={contractOf}
      onOpen={() => {}}
      onGo={() => {}}
      {...more}
    />,
  );

const diagram = () => screen.getByRole("region", { name: "Overview of the changed directories" });

describe("MiniOverview", () => {
  it("draws the overview's boxes, labeled by their last segment and a parent where two share it", () => {
    show(null);
    const boxes = within(diagram()).getAllByRole("button");
    expect(boxes.map((box) => box.textContent)).toEqual([
      "routes/",
      "http_api/",
      "delphi_code/domain/",
      "infrastructure/",
    ]);
    // The same places, scaled: the box nothing calls is on top, its callees in the row under it.
    const [first, second] = boxes;
    expect(Number.parseFloat(first?.style.top ?? "")).toBeLessThan(
      Number.parseFloat(second?.style.top ?? ""),
    );
    expect(diagram().querySelectorAll("path[data-slot=mini-edge]")).toHaveLength(3);
  });

  it("outlines the box holding the file in view, and moves the outline with it", () => {
    const { rerender } = show(paths[1] ?? null);
    const current = () =>
      [...diagram().querySelectorAll<HTMLElement>("button[data-current]")].map(
        (box) => box.dataset.key,
      );
    expect(current()).toEqual([routes.key]);
    expect(
      within(diagram()).getByRole("button", { name: /^routes\/.*in view in the code$/ }),
    ).toBeTruthy();

    rerender(
      <MiniOverview
        mini={mini}
        paths={paths}
        current={paths[3] ?? null}
        neighbors={neighbors}
        contractOf={contractOf}
        onOpen={() => {}}
        onGo={() => {}}
      />,
    );
    expect(current()).toEqual([keychain.key]);
  });

  it("lists the directories outside the diagram as chips with their file counts, and opens them", async () => {
    const onOpen = vi.fn();
    show(paths[5] ?? null, { onOpen });
    const chips = within(screen.getByRole("list", { name: "Not linked" })).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual(["src/domain/ 1 file", "./ 1 file"]);
    expect(chips[1]?.hasAttribute("data-current")).toBe(true);
    await userEvent.click(chips[0] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(webDomain);
  });

  it("opens a box's code on a click", async () => {
    const onOpen = vi.fn();
    show(null, { onOpen });
    await userEvent.click(within(diagram()).getByText("infrastructure/"));
    expect(onOpen).toHaveBeenCalledWith(keychain);
  });

  it("lists the current directory's files, then the files elsewhere that call it and that it calls", async () => {
    const onGo = vi.fn();
    show(paths[1] ?? null, { onGo });
    const here = screen.getByRole("region", { name: "This directory" });
    expect(within(here).getByRole("heading").textContent).toBe("delphi_code/http_api/routes/");
    expect(
      within(here)
        .getAllByRole("button")
        .map((row) => row.title),
    ).toEqual([paths[1]]);
    expect(within(here).getByRole("button").getAttribute("aria-current")).toBe("location");

    const calledBy = screen.getByRole("region", { name: "Called by" });
    expect(
      within(calledBy)
        .getAllByRole("button")
        .map((row) => row.textContent),
    ).toEqual(["↕calls and is called by the file in view, app.pydelphi_code/http_api/"]);
    const calls = screen.getByRole("region", { name: "Calls" });
    expect(
      within(calls)
        .getAllByRole("button")
        .map((row) => row.title),
    ).toEqual([
      "delphi_code/domain/hosting_services.py",
      "delphi_code/http_api/app.py",
      "delphi_code/infrastructure/keychain.py",
    ]);
    expect(within(calls).getAllByRole("button")[2]?.textContent).toContain("1 contract");

    await userEvent.click(within(calls).getAllByRole("button")[0] as HTMLElement);
    expect(onGo).toHaveBeenCalledWith("delphi_code/domain/hosting_services.py");
  });

  it("leaves out a list with nothing in it, and lists nothing without a file in view", () => {
    const { unmount } = show(paths[0] ?? null);
    expect(screen.queryByRole("region", { name: "Calls" })).toBeNull();
    expect(screen.getByRole("region", { name: "Called by" })).toBeTruthy();
    unmount();
    show(null);
    expect(screen.queryByRole("region", { name: "This directory" })).toBeNull();
  });

  it("says when it grouped the directories to fit", () => {
    show(null, { mini: { overview, depth: 2 } });
    expect(screen.getByText("Directories grouped to 2 levels to fit.")).toBeTruthy();
  });
});

describe("miniLists", () => {
  it("cuts directories to the grouped depth, so a box's files are one directory", () => {
    const lists = miniLists(paths[1] ?? "", paths, neighbors, 1);
    expect(lists.directory).toBe("delphi_code");
    expect(lists.here).toEqual(paths.slice(0, 4));
    expect(lists.calledBy).toEqual([]);
    expect(lists.calls).toEqual([]);
  });
});

describe("miniLabels", () => {
  it("keeps files outside the pull request named as they are", () => {
    const outside: OverviewNode = {
      ...top,
      key: "outside:lib/a.py",
      kind: "outside",
      label: "a.py",
    };
    expect([...miniLabels([routes, api, outside]).values()]).toEqual([
      "routes/",
      "http_api/",
      "a.py",
    ]);
  });
});

describe("fitMiniOverview", () => {
  /** A diagram of one row with a box per directory. */
  const wide = (directories: readonly string[]): FileOverview => ({
    ...overview,
    rows: [directories.map((directory, at) => node(directory, [`${directory}/f${at}.py`], 0))],
    edges: [],
    strip: [],
  });
  const many = Array.from({ length: 10 }, (_, at) => `a/b${at % 4}/c${at}`);

  it("keeps the full overview when it fits", () => {
    const build = vi.fn(() => overview);
    expect(fitMiniOverview(build, paths)).toEqual({ overview, depth: null });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("groups directories by their leading segments, from the deepest that fits", () => {
    const build = (depth?: number) =>
      wide([...new Set(many.map((directory) => directory.split("/").slice(0, depth).join("/")))]);
    const fitted = fitMiniOverview(
      build,
      many.map((directory) => `${directory}/x.py`),
    );
    expect(fitted.depth).toBe(2);
    expect(fitted.overview.rows[0]?.map((one) => one.key)).toEqual([
      "group:a/b0",
      "group:a/b1",
      "group:a/b2",
      "group:a/b3",
    ]);
  });

  it("keeps the narrowest when nothing fits, the full one if grouping doesn't narrow it", () => {
    const spread = Array.from({ length: 30 }, (_, at) => `a${at % 12}/b${at}`);
    const grouped = fitMiniOverview(
      (depth) =>
        wide([
          ...new Set(spread.map((directory) => directory.split("/").slice(0, depth).join("/"))),
        ]),
      spread.map((directory) => `${directory}/x.py`),
    );
    expect(grouped.depth).toBe(1);
    expect(grouped.overview.rows[0]).toHaveLength(12);

    const flat = Array.from({ length: 12 }, (_, at) => `d${at}/e`);
    const full = wide(flat);
    const kept = fitMiniOverview(
      (depth) => (depth === undefined ? full : wide(flat.map((one) => one.split("/")[0] ?? ""))),
      flat.map((directory) => `${directory}/x.py`),
    );
    expect(kept).toEqual({ overview: full, depth: null });
  });
});

describe("Rail", () => {
  it("switches between the tree and the overview", async () => {
    const onForm = vi.fn();
    render(
      <Rail form="tree" onForm={onForm}>
        <p>tree</p>
      </Rail>,
    );
    const switches = within(screen.getByRole("group")).getAllByRole("button");
    expect(switches.map((one) => [one.textContent, one.getAttribute("aria-pressed")])).toEqual([
      ["Tree", "true"],
      ["Overview", "false"],
    ]);
    await userEvent.click(switches[1] as HTMLElement);
    expect(onForm).toHaveBeenCalledWith("overview");
  });
});
