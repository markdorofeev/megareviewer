import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataFlow } from "./DataFlow.tsx";
import type { DataFlowView, FileFamily, FlowFile, FlowStation } from "./data-flow.ts";

const file = (path: string, more: Partial<FlowFile> = {}): FlowFile => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""),
  status: "new",
  calls: [],
  calledFor: [],
  added: 10,
  deleted: 0,
  ...more,
});

const alone = (one: FlowFile): FileFamily => ({
  key: one.path,
  suffix: null,
  files: [one],
  added: one.added,
  deleted: one.deleted,
});

const station = (
  name: string,
  families: FileFamily[],
  more: Partial<FlowStation> = {},
): FlowStation => ({
  name,
  when: null,
  keeps: false,
  families,
  gives: null,
  shapes: [],
  joined: true,
  added: families.reduce((sum, family) => sum + family.added, 0),
  deleted: families.reduce((sum, family) => sum + family.deleted, 0),
  ...more,
});

const recorders: FileFamily = {
  key: "pgo\u0000profile recorder",
  suffix: "ProfileRecorder",
  files: ["Branch", "CallCount", "Type"].map((kind) => file(`pgo/${kind}ProfileRecorder.java`)),
  added: 1200,
  deleted: 0,
};

const view: DataFlowView = {
  source: "`native-image --pgo-instrument`",
  stations: [
    station(
      "Add counters to the graph",
      [
        alone(file("hosted/InstrumentationPhase.java")),
        alone(
          file("hosted/CompileQueue.java", {
            status: "changed",
            added: 2,
            calls: ["compilationOptions", "a", "b", "c"],
          }),
        ),
      ],
      {
        when: "build time",
        gives: "a counter per branch",
        shapes: [alone(file("pgo/BranchProfileKey.java"))],
      },
    ),
    station("Profile tables, in memory", [recorders], {
      keeps: true,
      when: "run time",
      joined: false,
    }),
    station("Write the profile", [alone(file("pgo/ProfileDumper.java"))], {
      gives: "JSON, to a temporary file",
    }),
  ],
  end: "an `.iprof` file",
  off: [
    {
      id: "tests",
      label: "Tests",
      files: [{ path: "test/ProfileDumperTest.java", added: 58, deleted: 0 }],
      added: 58,
      deleted: 0,
    },
  ],
  shown: { added: 1232, deleted: 0 },
  total: { added: 1290, deleted: 0 },
};

const option = {
  provider: "claude-code" as const,
  providerName: "Claude Code",
  model: "claude-sonnet-5-5",
  modelName: "Sonnet 5.5",
  family: "Claude",
};

const renderFlow = (shown: DataFlowView = view) => {
  const onOpenFile = vi.fn();
  render(<DataFlow view={shown} option={option} focusKey={null} onOpenFile={onOpenFile} />);
  return { onOpenFile, flow: within(screen.getByRole("region", { name: /How data moves/ })) };
};

describe("DataFlow", () => {
  it("reads from where the data comes in, through each station, to where it ends up", () => {
    const { flow } = renderFlow();
    const items = flow.getAllByRole("listitem").filter((item) => item.dataset.slot !== undefined);
    expect(items.map((item) => item.dataset.slot)).toEqual([
      "flow-source",
      "flow-station",
      "flow-station",
      "flow-station",
      "flow-end",
    ]);
    expect(items[0]?.textContent).toBe("Comes in native-image --pgo-instrument");
    expect(items.at(-1)?.textContent).toBe("Ends up in an .iprof file");
    expect(flow.getAllByRole("heading", { level: 3 }).map((one) => one.textContent)).toEqual([
      "Add counters to the graph",
      "Profile tables, in memory",
      "Write the profile",
      "Not in the picture",
    ]);
  });

  it("says whose words it is", () => {
    const { flow } = renderFlow();
    expect(flow.getByText(/written by Sonnet 5.5 through Claude Code/)).toBeTruthy();
  });

  it("says in words what a station keeps, when it runs and what it hands on", () => {
    const { flow } = renderFlow();
    const [first, store] = flow
      .getAllByRole("listitem")
      .filter((item) => item.dataset.slot === "flow-station");
    if (first === undefined || store === undefined) throw new Error("the flow has stations");
    expect(within(first).getByText("build time")).toBeTruthy();
    expect(within(first).getByText("a counter per branch").closest("p")?.textContent).toBe(
      "Hands on: a counter per branch",
    );
    expect(within(first).queryByText("keeps data")).toBeNull();
    expect(within(store).getByText("keeps data")).toBeTruthy();
    expect(store.dataset.keeps).toBe("true");
  });

  it("opens a file in the code, and tells new files from existing ones in words", async () => {
    const { flow, onOpenFile } = renderFlow();
    await userEvent.click(flow.getByRole("button", { name: /^InstrumentationPhase, new file/ }));
    expect(onOpenFile).toHaveBeenCalledWith("hosted/InstrumentationPhase.java");
    const existing = flow.getByRole("button", {
      name: /^CompileQueue, existing file, 2 lines added/,
    });
    expect(existing.dataset.status).toBe("changed");
  });

  it("names what existing code calls on the flow, the first three", () => {
    const { flow } = renderFlow();
    const [seam] = within(flow.getAllByRole("list")[1] as HTMLElement).getAllByRole("listitem");
    expect(seam?.textContent).toBe("CompileQueue calls compilationOptions, a, b and 1 more");
  });

  it("shows files that end alike as one chip, which opens to them in place", async () => {
    const { flow, onOpenFile } = renderFlow();
    const family = flow.getByRole("button", { name: /^3 × …ProfileRecorder, new files/ });
    expect(family.getAttribute("aria-expanded")).toBe("false");
    expect(flow.queryByRole("button", { name: /^TypeProfileRecorder/ })).toBeNull();
    await userEvent.click(family);
    expect(family.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(flow.getByRole("button", { name: /^TypeProfileRecorder/ }));
    expect(onOpenFile).toHaveBeenCalledWith("pgo/TypeProfileRecorder.java");
  });

  it("puts the files that only define what's handed on with the handoff", () => {
    const { flow } = renderFlow();
    const key = flow.getByRole("button", { name: /^BranchProfileKey/ });
    expect(key.closest('[data-slot="flow-handoff"]')).not.toBeNull();
  });

  it("says where no call joins two neighbors, and nowhere else", () => {
    const { flow } = renderFlow();
    const handoffs = [...document.querySelectorAll<HTMLElement>('[data-slot="flow-handoff"]')];
    expect(handoffs.map((one) => one.dataset.joined)).toEqual(["true", "false", "true"]);
    expect(flow.getAllByText(/^Not checked: no call was found/)).toHaveLength(1);
  });

  it("counts what it leaves out in one line, and opens a kind to its files", async () => {
    const { flow, onOpenFile } = renderFlow();
    const off = within(flow.getByRole("region", { name: "Not in the picture" }));
    expect(off.getByText("58 of 1,290 changed lines")).toBeTruthy();
    const tests = off.getByRole("button", { name: /^Tests · 1 file/ });
    expect(off.queryByRole("button", { name: "ProfileDumperTest.java" })).toBeNull();
    await userEvent.click(tests);
    await userEvent.click(off.getByRole("button", { name: "ProfileDumperTest.java" }));
    expect(onOpenFile).toHaveBeenCalledWith("test/ProfileDumperTest.java");
  });

  it("says so when it leaves nothing out, and draws no end it wasn't given", () => {
    const { flow } = renderFlow({ ...view, source: null, end: null, off: [] });
    expect(flow.getByText("Every changed file is in the picture.")).toBeTruthy();
    expect(flow.queryByText("Comes in")).toBeNull();
    expect(flow.queryByText("Ends up in")).toBeNull();
    // The last station still says what it leaves.
    expect(flow.getByText("JSON, to a temporary file")).toBeTruthy();
  });

  it("focuses the file the page asks for, or the chip that holds it", () => {
    render(
      <DataFlow
        view={view}
        option={null}
        focusKey={{ key: "pgo/TypeProfileRecorder.java", n: 1 }}
        onOpenFile={() => {}}
      />,
    );
    expect(document.activeElement?.textContent).toContain("3 × …ProfileRecorder");
    expect(screen.getByText(/written by the AI review/)).toBeTruthy();
  });
});
