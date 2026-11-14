import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  fixtureModelOptions,
  lockedModelOptions,
  opencodeModelOptions,
} from "../../../dev/fixtures/index.ts";
import { ClaudeElement, type ClaudeRun } from "./ClaudeElement.tsx";
import {
  byProvider,
  LONG_GROUP,
  lockedReason,
  type ModelChoice,
  matching,
  pinnedOf,
} from "./model-choice.ts";

const choice: ModelChoice = {
  options: fixtureModelOptions.options,
  chosen: fixtureModelOptions.options[1] ?? null,
  defaultId: fixtureModelOptions.defaultId,
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

describe("byProvider with opencode", () => {
  it("makes each provider behind opencode a group of its own", () => {
    expect(
      byProvider(opencodeModelOptions.options).map(([first, group]) => [first.via, group.length]),
    ).toEqual([
      ["Claude Code, on your Pro plan", 3],
      ["Anthropic API", 3],
      ["opencode, on Anthropic", 12],
      ["opencode, on Ollama", 2],
    ]);
  });
});

describe("a long group", () => {
  const anthropic = opencodeModelOptions.options.filter((option) =>
    option.id.startsWith("opencode/anthropic/"),
  );
  const sonnet = anthropic.find((option) => option.model === "anthropic/claude-sonnet-5-5") ?? null;

  it("shows a short group whole", () => {
    const short = anthropic.slice(0, LONG_GROUP);
    expect(pinnedOf(short, null, null)).toBe(short);
  });

  it("shows the chosen and default options of a long one, else its first", () => {
    expect(pinnedOf(anthropic, sonnet, null)).toEqual([sonnet]);
    expect(pinnedOf(anthropic, null, "opencode/anthropic/claude-opus-5-5")).toEqual([anthropic[2]]);
    expect(pinnedOf(anthropic, null, null)).toEqual([anthropic[0]]);
  });

  it("filters the rest by every word, in the name or the ID, and none before a query", () => {
    const pinned = pinnedOf(anthropic, sonnet, null);
    expect(matching(anthropic, pinned, "")).toEqual([]);
    expect(matching(anthropic, pinned, "opus fast").map((option) => option.modelName)).toEqual([
      "Claude Opus 5.5 Fast",
    ]);
    expect(matching(anthropic, pinned, "SONNET").map((option) => option.modelName)).toEqual([
      "Claude Sonnet 5",
      "Claude Sonnet 4.6",
    ]);
    expect(matching(anthropic, pinned, "4-6").map((option) => option.modelName)).toEqual([
      "Claude Sonnet 4.6",
    ]);
  });

  it("opens with the field, and the models typed for under it, marked unmeasured", async () => {
    const withOpencode: ModelChoice = {
      ...choice,
      options: opencodeModelOptions.options,
      defaultId: opencodeModelOptions.defaultId,
    };
    render(
      <ClaudeElement
        analysis={run({
          stages: {
            ...run({}).stages,
            intent: "skipped",
            findings: "skipped",
            risk: "skipped",
            decisions: "skipped",
            tour: "skipped",
          },
        })}
        choice={withOpencode}
        running={false}
        startedAt={null}
        starting={false}
        error={null}
        points={[]}
        narrowed={null}
        onNarrow={() => {}}
        onRun={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Model:/ }));
    const menu = await screen.findByRole("menu");
    const field = within(menu).getByRole("textbox", {
      name: "Filter 11 more models through opencode, on Anthropic",
    });
    expect(within(menu).getAllByRole("menuitemradio", { name: /Claude Haiku 5\.5/ })).toHaveLength(
      1,
    );
    expect(within(menu).queryByRole("menuitemradio", { name: /Opus 5\.5 Fast/ })).toBeNull();
    await userEvent.type(field, "opus fast");
    expect(field).toMatchObject({ value: "opus fast" });
    const fast = within(menu).getByRole("menuitemradio", { name: /Opus 5\.5 Fast/ });
    expect(fast.textContent).toMatch(/unmeasured$/);
    // From the field, an arrow goes to the option beside it, not the menu's first.
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(fast);
    await userEvent.clear(field);
    await userEvent.type(field, "gemini");
    expect(within(menu).getByText("No model matches")).toBeTruthy();
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
      },
      modelError: { stage: "intent", code: "model-error", message: "Overloaded" },
      modelOption: other,
    });
    render(element(failed, false));
    expect(screen.getByRole("alert").textContent).toBe("Another couldn't finish: Overloaded");
  });
});
