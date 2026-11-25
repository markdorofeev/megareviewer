import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentType, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { HunkId } from "../../../../src/domain/diff/index.ts";
import { FlowBowTie } from "./FlowBowTie.tsx";
import { FlowLanes } from "./FlowLanes.tsx";
import { FlowRows } from "./FlowRows.tsx";
import type { FlowFolds, FlowViewProps } from "./flow-parts.tsx";
import type { FlowPaths, Stop } from "./flow-paths.ts";

const h = (n: number) => HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`);

const stop = (layer: string, label: string, n: number, more: Partial<Stop> = {}): Stop => ({
  path: `src/${layer}/${label}.java`,
  label,
  layer: `src/${layer}`,
  status: "changed",
  names: [],
  partIds: [h(n)],
  shared: 1,
  ...more,
});

const controller = stop("controllers", "OrderController", 1);
const service = stop("services", "OrderService", 2, { shared: 2, names: ["place"] });
const repository = stop("repositories", "OrderRepository", 3, { status: "new" });

const flow: FlowPaths = {
  paths: [
    {
      key: "flow:0",
      labels: ["POST /orders"],
      inPullRequest: true,
      outside: [],
      stops: [controller, service, repository],
      ends: [],
    },
    {
      key: "outside:src/jobs/RefundJob.java",
      labels: ["RefundJob.java"],
      inPullRequest: false,
      outside: ["src/jobs/RefundJob.java"],
      stops: [service, repository],
      ends: [{ label: "POST /refunds", partId: h(9) }],
    },
  ],
  layers: [
    { key: "src/controllers", label: "controllers" },
    { key: "src/services", label: "services" },
    { key: "src/repositories", label: "repositories" },
  ],
  calls: [
    { from: controller.path, to: service.path },
    { from: service.path, to: repository.path },
  ],
  unreached: [stop("config", "WebConfig", 4, { shared: 0 })],
  also: {
    tests: ["src/test/OrderServiceTest.java"],
    docs: [],
    generated: [],
    mechanical: [],
    other: [],
  },
};

/** A view with what the reviewer opened in it, which the page keeps. */
const withFolds = (View: ComponentType<FlowViewProps & FlowFolds>) => {
  const Kept = (props: FlowViewProps) => {
    const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
    return (
      <View
        {...props}
        opened={opened}
        onToggle={(key) =>
          setOpened((previous) =>
            previous.has(key)
              ? new Set([...previous].filter((one) => one !== key))
              : new Set([...previous, key]),
          )
        }
      />
    );
  };
  return Kept;
};
const Lanes = withFolds(FlowLanes);
const BowTie = withFolds(FlowBowTie);

const VIEWS = [
  ["rows", FlowRows],
  ["lanes", Lanes],
  ["bow tie", BowTie],
] as const;

// A route that runs four services, two of which call one of two repositories.
const services = ["Order", "Refund", "Stock", "Tax"].map((name, at) =>
  stop("services", `${name}Service`, 10 + at),
);
const repositories = ["Order", "Refund"].map((name, at) =>
  stop("repositories", `${name}Repository`, 20 + at, { status: "new" }),
);
const call = (from: Stop | undefined, to: Stop | undefined) =>
  from === undefined || to === undefined ? [] : [{ from: from.path, to: to.path }];
const wide: FlowPaths = {
  ...flow,
  paths: [
    {
      key: "flow:0",
      labels: ["POST /orders"],
      inPullRequest: true,
      outside: [],
      stops: [controller, ...services, ...repositories],
      ends: [],
    },
  ],
  calls: [
    ...services.flatMap((service) => call(controller, service)),
    ...call(services[0], repositories[0]),
    ...call(services[1], repositories[1]),
  ],
};

describe.each(VIEWS)("the overview as %s", (_name, View) => {
  const show = (focusKey: { key: string; n: number } | null = null) => {
    const onOpenPart = vi.fn();
    const onOpenFile = vi.fn();
    render(
      <View flow={flow} onOpenPart={onOpenPart} onOpenFile={onOpenFile} focusKey={focusKey} />,
    );
    return { onOpenPart, onOpenFile };
  };

  it("names where the change is reached, in the pull request and outside it", () => {
    show();
    expect(screen.getAllByText("POST /orders").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RefundJob.java").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Not in this PR/).length).toBeGreaterThan(0);
  });

  it("opens a changed file's first part, and says which file to come back to", async () => {
    const { onOpenPart } = show();
    const [button] = screen.getAllByRole("button", { name: /^OrderService, / });
    if (button === undefined) throw new Error("the service is a stop");
    await userEvent.click(button);
    expect(onOpenPart).toHaveBeenCalledWith(h(2), service.path);
  });

  it("keeps the code on no path and the tests in reach, off the paths", async () => {
    const { onOpenPart, onOpenFile } = show();
    const unreached = screen.getByRole("region", { name: "Changed code on no path" });
    await userEvent.click(within(unreached).getByRole("button", { name: /^WebConfig, changed/ }));
    expect(onOpenPart).toHaveBeenCalledWith(h(4), "src/config/WebConfig.java");
    const also = screen.getByRole("region", { name: "Also changed" });
    expect(within(also).getByText("Tests · 1")).not.toBeNull();
    await userEvent.click(within(also).getByRole("button", { name: "OrderServiceTest.java" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/test/OrderServiceTest.java");
  });

  it("focuses the file the page asks for", () => {
    show({ key: repository.path, n: 1 });
    expect(document.activeElement?.getAttribute("data-path")).toBe(repository.path);
  });

  it("says there are no flows when the pull request has none", () => {
    render(
      <View
        flow={{ ...flow, paths: [], layers: [], calls: [] }}
        onOpenPart={vi.fn()}
        onOpenFile={vi.fn()}
        focusKey={null}
      />,
    );
    expect(screen.getByText(/No flow was found/)).not.toBeNull();
  });
});

describe("the overview as rows and lanes", () => {
  it.each([
    ["rows", FlowRows],
    ["lanes", Lanes],
  ] as const)("says a stop's status and how many ways run it, as %s", (_name, View) => {
    render(<View flow={flow} onOpenPart={vi.fn()} onOpenFile={vi.fn()} focusKey={null} />);
    expect(
      screen.getAllByRole("button", { name: "OrderService, changed, place, on 2 paths" }),
    ).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "OrderRepository, new file" })).toHaveLength(2);
  });

  it("opens the route a path sends a request to", async () => {
    const onOpenPart = vi.fn();
    render(<FlowRows flow={flow} onOpenPart={onOpenPart} onOpenFile={vi.fn()} focusKey={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Sends POST /refunds to a route in this pull request" }),
    );
    expect(onOpenPart).toHaveBeenCalledWith(h(9), null);
  });
});

describe("the overview as lanes", () => {
  it("is a table of the paths by directory", () => {
    render(<Lanes flow={flow} onOpenPart={vi.fn()} onOpenFile={vi.fn()} focusKey={null} />);
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Reached from",
      "controllers/",
      "services/",
      "repositories/",
      "Sends",
    ]);
    const [, outside] = screen.getAllByRole("row").slice(1);
    if (outside === undefined) throw new Error("the outside path is a row");
    // The path from outside the pull request runs nothing in the controllers.
    const [controllers, services] = within(outside).getAllByRole("cell");
    if (controllers === undefined || services === undefined) throw new Error("it has cells");
    expect(within(controllers).queryByRole("button")).toBeNull();
    expect(within(services).getByRole("button").getAttribute("aria-label")).toMatch(
      /^OrderService, /,
    );
  });
});

describe("a cell of the lanes with more than three files", () => {
  const show = (focusKey: FlowViewProps["focusKey"] = null) =>
    render(<Lanes flow={wide} onOpenPart={vi.fn()} onOpenFile={vi.fn()} focusKey={focusKey} />);

  it("shows two, and the rest behind a button that says where they are", async () => {
    show();
    expect(screen.queryByRole("button", { name: /^TaxService, / })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "and 2 more in services/" }));
    expect(screen.getByRole("button", { name: /^TaxService, / })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show fewer in services/" }));
    expect(screen.queryByRole("button", { name: /^TaxService, / })).toBeNull();
  });

  it("takes the focus to the fold that holds the file the page asks for", () => {
    show({ key: services[3]?.path ?? "", n: 1 });
    expect(document.activeElement?.textContent).toBe("and 2 more");
  });
});

describe("a box of the bow tie with several files", () => {
  const show = (focusKey: FlowViewProps["focusKey"] = null) => {
    const onOpenPart = vi.fn();
    const props = { flow: wide, onOpenPart, onOpenFile: vi.fn() };
    const view = render(<BowTie {...props} focusKey={focusKey} />);
    return {
      onOpenPart,
      ask: (key: string, n: number) => view.rerender(<BowTie {...props} focusKey={{ key, n }} />),
    };
  };
  const boxes = () =>
    [...document.querySelectorAll("[data-slot=flow-bow-tie-node]")].map(
      (box) => box.querySelector("span.truncate")?.textContent,
    );
  const open = (name: string) => userEvent.click(screen.getByRole("button", { name }));

  it("opens in place to its files, each opening its own code", async () => {
    const { onOpenPart } = show();
    // The two services that call a repository are run through; the other two end the path.
    expect(boxes()).toEqual(["POST /orders", "services/", "services/", "repositories/"]);
    await open("Show the files of services/ under Runs through");
    expect(boxes()).toEqual([
      "POST /orders",
      "OrderService",
      "RefundService",
      "services/",
      "repositories/",
    ]);
    await userEvent.click(screen.getByRole("button", { name: /^RefundService, / }));
    expect(onOpenPart).toHaveBeenCalledWith(h(11), services[1]?.path);
  });

  it("opens and collapses from the keyboard, keeping the focus at its files", async () => {
    show();
    screen.getByRole("button", { name: "Show the files of repositories/ under Ends in" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement?.getAttribute("data-path")).toBe(repositories[0]?.path);
    await userEvent.tab();
    expect(document.activeElement?.getAttribute("data-path")).toBe(repositories[1]?.path);
    screen.getByRole("button", { name: "Collapse repositories/ · Ends in" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(boxes()).toEqual(["POST /orders", "services/", "services/", "repositories/"]);
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^repositories\//);
  });

  it("takes the focus to the box that holds the file the page asks for, or to its own", async () => {
    const refund = repositories[1]?.path ?? "";
    const { ask } = show({ key: refund, n: 1 });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^repositories\//);
    await open("Show the files of repositories/ under Ends in");
    ask(refund, 2);
    expect(document.activeElement?.getAttribute("data-path")).toBe(refund);
  });

  it("has nothing to open when it holds one file", () => {
    render(<BowTie flow={flow} onOpenPart={vi.fn()} onOpenFile={vi.fn()} focusKey={null} />);
    expect(screen.queryByRole("button", { name: /^Show the files/ })).toBeNull();
  });

  it("takes a file outside the pull request's box for its own, not for the code it uses", () => {
    render(
      <BowTie
        flow={flow}
        onOpenPart={vi.fn()}
        onOpenFile={vi.fn()}
        focusKey={{ key: service.path, n: 1 }}
      />,
    );
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^OrderService, /);
  });
});
