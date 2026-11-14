import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureModelOptions, lockedModelOptions } from "../../../dev/fixtures/index.ts";
import { ClaudeElement, type ClaudeRun } from "./ClaudeElement.tsx";
import { byProvider, lockedReason, type ModelChoice } from "./model-choice.ts";

const choice: ModelChoice = {
  options: fixtureModelOptions.options,
  chosen: fixtureModelOptions.options[1] ?? null,
  locked: null,
  choose: () => {},
};

const run = (overrides: Partial<ClaudeRun>): ClaudeRun => ({
  status: "complete",
  stages: {
    collect: "done",
    prep: "done",
    intent: "running",
    findings: "pending",
    risk: "pending",
    decisions: "pending",
    tour: "pending",
  },
  modelError: null,
  modelOption: null,
  ...overrides,
});

const element = (analysis: ClaudeRun, running: boolean) => (
  <ClaudeElement
    analysis={analysis}
    choice={choice}
    running={running}
    startedAt={null}
    starting={false}
    error={null}
    points={[]}
    narrowed={null}
    onNarrow={() => {}}
    onRun={() => {}}
  />
);

describe("byProvider", () => {
  it("groups the options by provider, in their order", () => {
    expect(
      byProvider(fixtureModelOptions.options).map(([first, group]) => [
        first.providerName,
        group.length,
      ]),
    ).toEqual([
      ["Claude Code", 3],
      ["Anthropic API", 3],
    ]);
  });
});

describe("lockedReason", () => {
  it("is null while any option can run, and each provider's reason once when none can", () => {
    expect(lockedReason(fixtureModelOptions.options)).toBeNull();
    expect(lockedReason(lockedModelOptions.options)?.split("; or ")).toHaveLength(2);
    expect(lockedReason([])).toBe("No model is known to megareviewer");
  });
});

const other: ClaudeRun["modelOption"] = {
  provider: "claude-code",
  providerName: "Claude Code",
  model: "claude-sonnet-5-5",
  modelName: "Sonnet 5.5",
  family: "Another",
};

describe("the model's name on the page", () => {
  it("reads the run's model family, not a fixed one", () => {
    render(element(run({ modelOption: other }), true));
    expect(screen.getByRole("status").textContent).toMatch(/^Another is reading this PR/);
  });

  it("before a run, reads the current choice", () => {
    render(element(run({}), true));
    expect(screen.getByRole("status").textContent).toMatch(/^Claude is reading this PR/);
  });

  it("says who couldn't finish", () => {
    const failed = run({
      stages: {
        ...run({}).stages,
        intent: "failed",
        findings: "skipped",
        risk: "skipped",
        decisions: "skipped",
        tour: "skipped",
      },
      modelError: { stage: "intent", code: "model-error", message: "Overloaded" },
      modelOption: other,
    });
    render(element(failed, false));
    expect(screen.getByRole("alert").textContent).toBe("Another couldn't finish: Overloaded");
  });
});
