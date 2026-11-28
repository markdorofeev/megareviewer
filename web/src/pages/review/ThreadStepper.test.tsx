import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type Point,
  PointId,
  type ReviewThread,
  type ThreadId,
} from "../../../../src/domain/review/index.ts";
import { fixtureModelOptions, fixtureThreads } from "../../../dev/fixtures/index.ts";
import { ClaudeElement, type ClaudeRun } from "./ClaudeElement.tsx";
import type { ModelChoice } from "./model-choice.ts";
import { ThreadStepper, threadChip } from "./ThreadStepper.tsx";

const [tax, attempts, money, earlier] = fixtureThreads.threads as [
  ReviewThread,
  ReviewThread,
  ReviewThread,
  ReviewThread,
];
// The page's order.
const ORDERED = [earlier, attempts, tax, money];

const stepper = (props: {
  readonly ordered?: readonly ReviewThread[];
  readonly current?: ThreadId | null;
  readonly onGo?: (id: ThreadId) => void;
}) =>
  render(
    <ThreadStepper
      ordered={props.ordered ?? ORDERED}
      current={props.current ?? null}
      onGo={props.onGo ?? (() => {})}
    />,
  );
const position = () => screen.getByRole("button", { name: /, show all$/ });

describe("ThreadStepper", () => {
  it("counts the steps before the first, with no Start: the list is the way in", () => {
    stepper({});
    expect(screen.getByRole("group", { name: "Threads" })).toBeTruthy();
    expect(position().textContent).toBe("3 unresolvedin 2 files");
    expect(position().getAttribute("aria-label")).toBe("3 unresolved, show all");
    expect(screen.queryByRole("button", { name: /^Go to thread/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous thread" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Start|Next thread)$/ })).toBeNull();
  });

  it("goes up and down the page from a thread outside the steps", () => {
    const onGo = vi.fn();
    // A resolved thread, gone to from the list, isn't one of the unresolved steps.
    stepper({ current: "PRRT_money", onGo });
    expect(position().textContent).toBe("3 unresolved");
    fireEvent.click(screen.getByRole("button", { name: "Previous thread" }));
    fireEvent.click(screen.getByRole("button", { name: "Next thread" }));
    expect(onGo).toHaveBeenCalledTimes(2);
  });

  it("names the thread it's on, and says its place to a screen reader", () => {
    stepper({ current: "PRRT_attempts" });
    expect(position().textContent).toBe("2 of 3");
    const title = screen.getByRole("button", {
      name: "Go to thread: Lee Park: Name says what it counts.",
    });
    expect(title.getAttribute("title")).toBe("src/services/receipts.ts, line 29");
    expect(screen.getByRole("status").textContent).toBe(
      "Thread 2 of 3, src/services/receipts.ts line 29: Lee Park: Name says what it counts.",
    );
  });

  it("leaves out a resolved thread, and steps on from it by its place", () => {
    const onGo = vi.fn();
    const resolved = { ...attempts, resolved: true };
    stepper({ ordered: [earlier, resolved, tax, money], current: "PRRT_attempts", onGo });
    expect(position().textContent).toBe("2 unresolved");
    fireEvent.click(screen.getByRole("button", { name: "Next thread" }));
    expect(onGo).toHaveBeenCalledWith("PRRT_tax");
  });

  it("stays on the one thread there is", () => {
    const onGo = vi.fn();
    stepper({ ordered: [tax], current: "PRRT_tax", onGo });
    expect(position().textContent).toBe("1 of 1");
    fireEvent.click(screen.getByRole("button", { name: "Next thread" }));
    expect(onGo).toHaveBeenCalledWith("PRRT_tax");
  });

  it("can't step when there are no steps", () => {
    stepper({ ordered: [money] });
    // Every thread is resolved: nothing to go round.
    expect(position().textContent).toBe("0 unresolved");
    expect(screen.queryByRole("button", { name: /^(Start|Next thread)$/ })).toBeNull();
  });
});

describe("threadChip", () => {
  it("counts the unresolved threads, and is null without any", () => {
    expect(threadChip(ORDERED)).toEqual({
      count: 3,
      words: ["unresolved", "unresolved"],
      label: "3 unresolved threads",
    });
    expect(threadChip([money])).toBeNull();
    expect(threadChip([])).toBeNull();
  });
});

describe("ThreadList", () => {
  it("lists the unresolved threads under their file, in the page's order", async () => {
    const onGo = vi.fn();
    stepper({ current: "PRRT_attempts", onGo });
    fireEvent.click(position());
    const dialog = await screen.findByRole("dialog", { name: "3 unresolved threads" });
    const files = within(dialog)
      .getAllByRole("region")
      .map((one) => one.getAttribute("aria-label"));
    // money.ts has only a resolved thread.
    expect(files).toEqual(["src/routes/orders.ts", "src/services/receipts.ts"]);
    const rows = within(dialog)
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe("Lee Park: Return a 404 here too.Outdatedline 58");
    expect(within(dialog).queryByRole("button", { name: /^All/ })).toBeNull();
    const here = within(dialog).getByRole("button", { name: /Name says what it counts/ });
    expect(here.getAttribute("aria-current")).toBe("true");
    fireEvent.click(here);
    expect(onGo).toHaveBeenCalledWith("PRRT_attempts");
  });
});

describe("ClaudeElement with threads", () => {
  const choice: ModelChoice = {
    options: fixtureModelOptions.options,
    chosen: fixtureModelOptions.options[1] ?? null,
    defaultId: fixtureModelOptions.defaultId,
    locked: null,
    choose: () => {},
  };
  const run = (stage: "skipped" | "running" | "done"): ClaudeRun => ({
    status: "complete",
    stages: {
      collect: "done",
      prep: "done",
      intent: stage,
      findings: stage,
      steps: "skipped",
    },
    modelError: null,
    modelOption: null,
    usage: [],
  });
  const finding: Point = {
    id: PointId.parse("f1"),
    title: "Any signed-in user can read any receipt",
    explanation: "",
    hunkIds: [],
    path: null,
    lines: null,
    type: "logic",
    severity: "major",
    suggestion: null,
    mismatch: null,
  };
  const element = (props: {
    readonly analysis: ClaudeRun;
    readonly running?: boolean;
    readonly points?: readonly Point[];
    readonly onNarrow?: (kind: string | null) => void;
  }) =>
    render(
      <ClaudeElement
        analysis={props.analysis}
        choice={choice}
        running={props.running ?? false}
        starting={false}
        error={null}
        points={props.points ?? []}
        threads={threadChip(ORDERED)}
        narrowed={null}
        onNarrow={props.onNarrow ?? (() => {})}
        onRun={() => {}}
      >
        <span data-testid="stepper">stepper</span>
      </ClaudeElement>,
    );

  it("keeps the stepper beside the button before the run, and beside its words during it", () => {
    const before = element({ analysis: run("skipped") });
    expect(screen.getByRole("button", { name: "Request AI review" })).toBeTruthy();
    expect(screen.getByTestId("stepper")).toBeTruthy();
    // The threads' chip is among Claude's chips, which there are none of yet.
    expect(screen.queryByRole("button", { name: "3 unresolved threads" })).toBeNull();
    before.unmount();
    element({ analysis: run("running"), running: true });
    expect(screen.getByText(/is reading this PR/)).toBeTruthy();
    expect(screen.getByTestId("stepper")).toBeTruthy();
  });

  it("puts the threads' chip after the pager, and narrows to them", () => {
    const onNarrow = vi.fn();
    element({ analysis: run("done"), points: [finding], onNarrow });
    const receipt = document.querySelector("[data-slot=claude-receipt]");
    expect(
      [...(receipt?.children ?? [])].map((one) => one.getAttribute("data-slot") ?? one.textContent),
    ).toEqual(["stepper", "thread-chip"]);
    const chip = screen.getByRole("button", { name: "3 unresolved threads" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(onNarrow).toHaveBeenCalledWith("thread");
  });
});
