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
import { ThreadList, ThreadStepper, threadChip } from "./ThreadStepper.tsx";

const [tax, attempts, money, earlier] = fixtureThreads.threads as [
  ReviewThread,
  ReviewThread,
  ReviewThread,
  ReviewThread,
];
// The page's order.
const ORDERED = [earlier, attempts, tax, money];
const NONE: ReadonlySet<ThreadId> = new Set();

const stepper = (props: {
  readonly ordered?: readonly ReviewThread[];
  readonly current?: ThreadId | null;
  readonly resolvedHere?: ReadonlySet<ThreadId>;
  readonly onGo?: (id: ThreadId) => void;
}) =>
  render(
    <ThreadStepper
      ordered={props.ordered ?? ORDERED}
      scope="unresolved"
      resolvedHere={props.resolvedHere ?? NONE}
      current={props.current ?? null}
      onGo={props.onGo ?? (() => {})}
      onOpenList={() => {}}
    />,
  );
const position = () => screen.getByRole("button", { name: /, show all$/ });

describe("ThreadStepper", () => {
  it("counts the steps before the first, and goes to the first and the last", () => {
    const onGo = vi.fn();
    stepper({ onGo });
    expect(position().textContent).toBe("3 unresolved");
    expect(position().getAttribute("aria-label")).toBe("3 unresolved, show all");
    expect(screen.queryByRole("button", { name: /^Go to thread/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next thread" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous thread" }));
    expect(onGo.mock.calls).toEqual([["PRRT_earlier"], ["PRRT_tax"]]);
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

  it("marks a thread resolved here, which stays a step", () => {
    const resolved = { ...attempts, resolved: true };
    stepper({
      ordered: [earlier, resolved, tax, money],
      current: "PRRT_attempts",
      resolvedHere: new Set(["PRRT_attempts"]),
    });
    expect(position().textContent).toBe("2 of 3");
    expect(screen.getByRole("status").textContent).toMatch(/line 29, resolved: /);
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
    // Every thread is resolved and the scope was chosen as unresolved: nothing to go round.
    expect(position().textContent).toBe("0 unresolved");
    expect(screen.getByRole("button", { name: "Next thread" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("threadChip", () => {
  it("counts the steps, and names what they are", () => {
    expect(threadChip(ORDERED, "unresolved", NONE)).toEqual({
      count: 3,
      words: ["unresolved", "unresolved"],
      label: "3 unresolved threads",
    });
    expect(threadChip(ORDERED, "all", NONE)?.label).toBe("4 threads");
    expect(threadChip([], "unresolved", NONE)).toBeNull();
  });
});

describe("ThreadList", () => {
  it("lists every thread under its file, in the page's order, and chooses what the steps cover", () => {
    const onScope = vi.fn();
    const onGo = vi.fn();
    render(
      <ThreadList
        ordered={ORDERED}
        scope="unresolved"
        onScope={onScope}
        onGo={onGo}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "4 threads, 3 unresolved" });
    const files = within(dialog)
      .getAllByRole("region")
      .map((one) => one.getAttribute("aria-label"));
    expect(files).toEqual(["src/routes/orders.ts", "src/services/receipts.ts", "src/lib/money.ts"]);
    const rows = within(dialog)
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(rows[0]).toBe("Lee Park: Return a 404 here too.Outdatedline 58");
    expect(rows[3]).toBe("Lee Park: Rounds half-cents up?Resolvedline 2");
    expect(
      within(dialog).getByRole("button", { name: "Unresolved (3)" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "All (4)" }));
    expect(onScope).toHaveBeenCalledWith("all");
    fireEvent.click(within(dialog).getByRole("button", { name: /Name says what it counts/ }));
    expect(onGo).toHaveBeenCalledWith("PRRT_attempts");
  });

  it("offers no choice when every thread is unresolved", () => {
    render(
      <ThreadList
        ordered={[tax, attempts]}
        scope="unresolved"
        onScope={() => {}}
        onGo={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /^All/ })).toBeNull();
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
      risk: stage,
      decisions: stage,
    },
    modelError: null,
    modelOption: null,
    usage: [],
  });
  const finding: Point = {
    id: PointId.parse("f1"),
    kind: "finding",
    title: "Any signed-in user can read any receipt",
    explanation: "",
    hunkIds: [],
    path: null,
    lines: null,
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
        threads={threadChip(ORDERED, "unresolved", NONE)}
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

  it("puts the threads' chip after the points', and narrows to them", () => {
    const onNarrow = vi.fn();
    element({ analysis: run("done"), points: [finding], onNarrow });
    const chips = [...document.querySelectorAll("[data-slot=point-chip]")].map((chip) =>
      chip.getAttribute("data-kind"),
    );
    expect(chips).toEqual(["finding", "thread"]);
    const chip = screen.getByRole("button", { name: "3 unresolved threads" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(onNarrow).toHaveBeenCalledWith("thread");
  });
});
