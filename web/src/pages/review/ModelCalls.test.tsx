import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ModelCall } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView } from "../../../dev/fixtures/index.ts";
import { chronological, formatOffset, ModelCalls } from "./ModelCalls.tsx";

const calls = fixtureAnalysisView.analysis.modelCalls;

/** A pass of a run stored while there was one. */
const failed: ModelCall = {
  pass: "decisions",
  attempt: 1,
  startedAt: "2026-10-21T09:00:31.200Z",
  durationMs: 4_000,
  outcome: "failed",
  problems: [],
  error: { kind: "overloaded", message: "Anthropic is overloaded or failing: 529" },
  reads: [],
};

describe("ModelCalls", () => {
  it("lists every call in the order it started, a retry after its first try", () => {
    const passes = chronological(calls).map((call) => `${call.pass}/${call.attempt}`);
    expect(passes).toEqual(["intent/1", "findings/1", "findings/2"]);
  });

  it("says why a pass ran again, and why one failed", () => {
    render(
      <ModelCalls calls={[...calls, failed]} option={fixtureAnalysisView.analysis.modelOption} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run details…" }));
    const dialog = screen.getByRole("dialog", { name: "Claude's calls" });

    expect(
      within(dialog).getByText(
        /^On Sonnet 5\.5 through Claude Code\. 128\.3 s from the first call/,
      ),
    ).toBeTruthy();
    const findings = within(dialog).getAllByRole("row")[2];
    expect(findings?.textContent).toContain("⚠ 2 problems");
    expect(findings?.textContent).toContain(
      "Finding 4's explanation is longer than 300 characters.",
    );
    expect(within(dialog).getByRole("row", { name: /Decisions/ }).textContent).toContain(
      "✕ Failed: overloaded",
    );
    expect(within(dialog).getByText("Anthropic is overloaded or failing: 529")).toBeTruthy();
  });

  it("lists what each call read of the harness, and what it was refused", () => {
    const read = (path: string, lines: readonly [number, number] | null, outcome = "read") => ({
      path,
      fromLine: lines?.[0] ?? null,
      toLine: lines?.[1] ?? null,
      outcome: outcome === "read" ? ("read" as const) : ("refused" as const),
    });
    const reading: ModelCall = {
      ...failed,
      error: { kind: "reader", message: "The pass was stopped: it tried to read /etc/hosts." },
      reads: [
        read("harness/docs/rules.md", null),
        read("harness/docs/rules.md", null),
        read("harness/ARCHITECTURE.md", [27, 69]),
        read("/etc/hosts", null, "refused"),
      ],
    };
    render(<ModelCalls calls={[reading]} option={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Run details…" }));
    const row = within(screen.getByRole("dialog")).getAllByRole("row")[1];
    expect(row?.textContent).toContain("it tried to read /etc/hosts");
    expect(row?.textContent).toContain(
      "Readharness/docs/rules.mdharness/ARCHITECTURE.md, lines 27–69Refused/etc/hosts",
    );
  });

  it("shows nothing before Claude has run", () => {
    const { container } = render(<ModelCalls calls={[]} option={null} />);
    expect(container.textContent).toBe("");
  });

  it("counts from the run's first call", () => {
    expect([formatOffset(0), formatOffset(65_400), formatOffset(600_000)]).toEqual([
      "+0:00",
      "+1:05",
      "+10:00",
    ]);
  });
});
