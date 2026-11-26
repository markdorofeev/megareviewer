import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { type Point, PointId, PreferenceId } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView } from "../../../dev/fixtures/index.ts";
import { scopeOptions } from "../preferences/rule.tsx";
import { FindingCard } from "./PointCard.tsx";

const analysis = fixtureAnalysisView.analysis;
const [file] = analysis.files;
const hunk = file?.hunks[0];
if (file === undefined || hunk === undefined) throw new Error("the fixture changes files");
const shown = hunk.lines.find((line) => line.kind !== "del" && line.newLine !== null);
if (shown?.newLine == null) throw new Error("the fixture's first hunk shows new lines");

const finding: Point = {
  id: PointId.parse("f1"),
  title: "`r` says nothing of what it holds",
  explanation: "Name it for the rendered receipt.",
  path: file.path,
  lines: { hunkId: hunk.id, side: "new", startLine: shown.newLine, line: shown.newLine },
  hunkIds: [hunk.id],
  type: "logic",
  severity: "minor",
  suggestion: null,
  mismatch: null,
};
const repo = analysis.key.ref.repo;
const REPO_PREFERENCES = `/preferences?scope=${repo.host}/${repo.owner}/${repo.repo}`;
const actions = {
  state: "open" as const,
  saving: false,
  readOnly: false,
  current: false,
  onRaise: vi.fn(),
  onState: vi.fn(),
  leftOut: false,
  onShow: vi.fn(),
  ruleScopes: scopeOptions([repo]).reverse(),
  onRule: vi.fn(async () => null),
};

const findingProps = { inReview: false, removed: null, language: null };
const fromPreference = {
  effect: "raised" as const,
  label: "Lookups that aren't scoped to the signed-in user",
  preferenceId: PreferenceId.parse("pref_00000000000000a1"),
  everywhere: true,
};
const leftOutByPreference = {
  effect: "left-out" as const,
  label: "Naming",
  preferenceId: PreferenceId.parse("pref_00000000000000a2"),
  everywhere: true,
};

const guidanceLine = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-slot=point-guidance]");

describe("a finding's card", () => {
  const chips = (container: HTMLElement) =>
    [...container.querySelectorAll("[data-slot=finding-type], [data-slot=severity]")].map(
      (chip) => chip.textContent,
    );

  it("says its type in a word, before its severity", () => {
    const { container, rerender } = render(
      <FindingCard point={finding} {...actions} {...findingProps} />,
    );
    expect(chips(container)).toEqual(["ƒlogic", "●minor"]);
    rerender(
      <FindingCard
        point={{ ...finding, type: "architecture", severity: "blocking" }}
        {...actions}
        {...findingProps}
      />,
    );
    expect(chips(container)).toEqual(["≡architecture", "■blocking"]);
    for (const glyph of container.querySelectorAll("[data-slot=finding-type] > span")) {
      expect(glyph.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("says neither of a mismatch no finding names", () => {
    const { container } = render(
      <FindingCard
        point={{ ...finding, id: PointId.parse("m1"), type: null, severity: null }}
        {...actions}
        {...findingProps}
      />,
    );
    expect(chips(container)).toEqual([]);
  });
});

describe("a point's guidance", () => {
  it("says which preference raised it, as a link to its scope's preferences", () => {
    const { container } = render(
      <FindingCard
        point={{ ...finding, guidance: fromPreference }}
        {...actions}
        {...findingProps}
      />,
    );
    const line = guidanceLine(container);
    expect(line?.textContent).toBe(
      "From your preference: Lookups that aren't scoped to the signed-in user",
    );
    expect(line?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const link = within(line as HTMLElement).getByRole("link");
    expect(link.textContent).toBe(fromPreference.label);
    expect(link.getAttribute("href")).toBe("/preferences");
  });

  it("links a preference for this repository to the repository's preferences", () => {
    render(
      <FindingCard
        point={{ ...finding, guidance: { ...fromPreference, everywhere: false } }}
        {...actions}
        {...findingProps}
      />,
    );
    expect(screen.getByRole("link", { name: fromPreference.label }).getAttribute("href")).toBe(
      REPO_PREFERENCES,
    );
  });

  it("names the guideline file a finding comes from", () => {
    const { container } = render(
      <FindingCard
        point={{
          ...finding,
          guidance: { effect: "raised", label: "REVIEW.md", preferenceId: null, everywhere: false },
        }}
        {...actions}
        {...findingProps}
      />,
    );
    expect(guidanceLine(container)?.textContent).toBe("From REVIEW.md");
    expect(screen.getByRole("link", { name: "REVIEW.md" }).getAttribute("href")).toBe(
      REPO_PREFERENCES,
    );
  });

  it("says nothing on a point no guidance shaped", () => {
    const { container } = render(<FindingCard point={finding} {...actions} {...findingProps} />);
    expect(guidanceLine(container)).toBeNull();
  });

  it("renders a preference's text as text", () => {
    const label = '<img src=x onerror="alert(1)"> **bold**';
    const { container } = render(
      <FindingCard
        point={{ ...finding, guidance: { ...fromPreference, label } }}
        {...actions}
        {...findingProps}
      />,
    );
    expect(guidanceLine(container)?.textContent).toContain(label);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("a point's guardrail", () => {
  const rule = {
    is: "rule" as const,
    tool: "biome" as const,
    rule: "noFloatingPromises",
    configPath: "biome.json",
  };
  const suggested = {
    is: "suggested" as const,
    kind: "architecture-rule" as const,
    engine: "ArchUnit",
    does: "Services never import a controller.",
  };
  const line = (container: HTMLElement) =>
    container.querySelector<HTMLElement>("[data-slot=guardrail]");

  it("names a verified rule on a finding: its tool and the config that doesn't turn it on", () => {
    const { container } = render(
      <FindingCard point={{ ...finding, guardrail: rule }} {...actions} {...findingProps} />,
    );
    expect(line(container)?.textContent).toBe(
      "A check could catch this: noFloatingPromises in Biome, which biome.json doesn't turn on.",
    );
    expect(
      [...(line(container)?.querySelectorAll("code") ?? [])].map((code) => code.textContent),
    ).toEqual(["noFloatingPromises", "biome.json"]);
    expect(line(container)?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("says a suggested check is the model's, by the run's family", () => {
    const { container } = render(
      <FindingCard
        point={{ ...finding, guardrail: suggested }}
        {...actions}
        {...findingProps}
        family="GPT"
      />,
    );
    expect(line(container)?.textContent).toBe(
      "This looks checkable: an architecture rule in ArchUnit. Services never import a controller. Suggested by GPT, not checked.",
    );
    expect(line(container)?.dataset.guardrail).toBe("suggested");
  });

  it("says nothing on a point without one, nor on one folded, and shows it once a left-out one is", async () => {
    const { container, rerender } = render(
      <FindingCard point={finding} {...actions} {...findingProps} />,
    );
    expect(line(container)).toBeNull();
    rerender(
      <FindingCard
        point={{ ...finding, guardrail: rule }}
        {...actions}
        {...findingProps}
        state="dismissed"
      />,
    );
    expect(line(container)).toBeNull();
    const leftOut = { ...finding, guardrail: rule, guidance: leftOutByPreference };
    rerender(<FindingCard point={leftOut} {...actions} {...findingProps} leftOut />);
    expect(line(container)).toBeNull();
    rerender(<FindingCard point={leftOut} {...actions} {...findingProps} leftOut={false} />);
    expect(line(container)).not.toBeNull();
  });

  it("renders the model's words as text", () => {
    const does = "<b>x</b>";
    const { container } = render(
      <FindingCard
        point={{ ...finding, guardrail: { ...suggested, does } }}
        {...actions}
        {...findingProps}
      />,
    );
    expect(line(container)?.textContent).toContain(does);
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("a point a preference left out", () => {
  const leftOut = { ...finding, guidance: leftOutByPreference };

  it("is folded to one line that names the preference, with Show", async () => {
    const onShow = vi.fn();
    const { container } = render(
      <FindingCard point={leftOut} {...actions} {...findingProps} leftOut onShow={onShow} />,
    );
    const line = screen.getByRole("article", { name: finding.title });
    expect(line.dataset.leftOut).toBe("true");
    expect(line.textContent).toBe(
      "Finding: `r` says nothing of what it holdsLeft out by your preference: NamingShow",
    );
    expect(container.querySelector("h3")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Dismiss/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: `Show: ${finding.title}` }));
    expect(onShow).toHaveBeenCalledWith(finding.id);
  });

  it("shown, is its card with the same line on it, and takes the focus", async () => {
    const Shown = () => {
      const [folded, setFolded] = useState(true);
      return (
        <FindingCard
          point={leftOut}
          {...actions}
          {...findingProps}
          leftOut={folded}
          onShow={() => setFolded(false)}
        />
      );
    };
    const { container } = render(<Shown />);
    await userEvent.click(screen.getByRole("button", { name: /^Show: / }));
    const card = screen.getByRole("article", { name: finding.title });
    expect(document.activeElement).toBe(card);
    expect(card.dataset.leftOut).toBeUndefined();
    expect(guidanceLine(container)?.textContent).toBe("Left out by your preference: Naming");
    expect(within(card).getByRole("button", { name: `Dismiss: ${finding.title}` })).toBeTruthy();
  });

  it("folds one a guideline file says to leave out", () => {
    render(
      <FindingCard
        point={{
          ...finding,
          guidance: {
            effect: "left-out",
            label: "REVIEW.md",
            preferenceId: null,
            everywhere: false,
          },
        }}
        {...actions}
        {...findingProps}
        leftOut
      />,
    );
    expect(screen.getByRole("article").textContent).toContain("Left out by REVIEW.md");
  });

  it("is its dismissed line once dismissed, not the left-out one", () => {
    render(
      <FindingCard point={leftOut} {...actions} {...findingProps} leftOut state="dismissed" />,
    );
    expect(screen.getByRole("article").textContent).toContain("Dismissed");
    expect(screen.queryByRole("button", { name: /^Show/ })).toBeNull();
  });
});

describe("Don't flag things like this", () => {
  const openRule = async (title: string) => {
    await userEvent.click(screen.getByRole("button", { name: `More ways to dismiss: ${title}` }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Don't flag things like this…" }),
    );
    return screen.getByRole("form", { name: `Don't flag things like: ${title}` });
  };

  it("opens a rule drafted from the point: Don't flag, its title, this repository", async () => {
    const onRule = vi.fn(async () => null);
    const onState = vi.fn();
    render(
      <FindingCard
        point={finding}
        {...actions}
        {...findingProps}
        onRule={onRule}
        onState={onState}
      />,
    );
    const form = await openRule(finding.title);
    expect(form.querySelector("[data-slot=preference-kind]")?.textContent).toBe("Don't flag");
    expect(within(form).queryByRole("button", { name: "Look for" })).toBeNull();
    const field = within(form).getByRole<HTMLTextAreaElement>("textbox");
    expect(field.value).toBe(finding.title);
    expect(document.activeElement).toBe(field);
    expect(within(form).getByRole("combobox", { name: "Applies to" }).textContent).toContain(
      "acme/shop",
    );
    await userEvent.clear(field);
    await userEvent.type(field, "Short names of locals");
    await userEvent.click(within(form).getByRole("button", { name: "Save and dismiss" }));
    expect(onRule).toHaveBeenCalledWith(finding, {
      kind: "dont-flag",
      text: "Short names of locals",
      scope: { kind: "repo", repo },
    });
    // The page dismisses the point once the rule is saved; the card only asks.
    expect(onState).not.toHaveBeenCalled();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("saves for everywhere when the reviewer chooses it", async () => {
    const onRule = vi.fn(async () => null);
    render(<FindingCard point={finding} {...actions} {...findingProps} onRule={onRule} />);
    const form = await openRule(finding.title);
    await userEvent.click(within(form).getByRole("combobox", { name: "Applies to" }));
    await userEvent.click(await screen.findByRole("option", { name: "Everywhere" }));
    await userEvent.click(within(form).getByRole("button", { name: "Save and dismiss" }));
    expect(onRule).toHaveBeenCalledWith(finding, {
      kind: "dont-flag",
      text: finding.title,
      scope: { kind: "global" },
    });
  });

  it("does neither on Cancel, and gives the card the focus back", async () => {
    const onRule = vi.fn(async () => null);
    const onState = vi.fn();
    render(
      <FindingCard
        point={finding}
        {...actions}
        {...findingProps}
        onRule={onRule}
        onState={onState}
      />,
    );
    const form = await openRule(finding.title);
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).toBeNull();
    expect(onRule).not.toHaveBeenCalled();
    expect(onState).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("article"));
    expect(screen.getByRole("button", { name: `Dismiss: ${finding.title}` })).toBeTruthy();
  });

  it("says why the rule wasn't saved, and keeps the form", async () => {
    const onRule = vi.fn(async () => "50 preferences are already enabled for acme/shop.");
    render(<FindingCard point={finding} {...actions} {...findingProps} onRule={onRule} />);
    const form = await openRule(finding.title);
    await userEvent.click(within(form).getByRole("button", { name: "Save and dismiss" }));
    expect(await within(form).findByText(/50 preferences are already enabled/)).toBeTruthy();
    expect(screen.getByRole("form")).toBeTruthy();
  });

  it("says on the dismissed line that the rule was saved, with a link to its scope", async () => {
    const Saved = () => {
      const [state, setState] = useState<"open" | "dismissed">("open");
      return (
        <FindingCard
          point={finding}
          {...actions}
          {...findingProps}
          state={state}
          onRule={async () => {
            setState("dismissed");
            return null;
          }}
        />
      );
    };
    render(<Saved />);
    const form = await openRule(finding.title);
    await userEvent.click(within(form).getByRole("button", { name: "Save and dismiss" }));
    const line = await screen.findByText(/Dismissed, and saved to your/);
    expect(within(line).getByRole("link", { name: "preferences" }).getAttribute("href")).toBe(
      REPO_PREFERENCES,
    );
  });

  it("can't be opened on a point that can't be acted on", () => {
    render(<FindingCard point={finding} {...actions} {...findingProps} readOnly />);
    const menu = screen.getByRole("button", { name: /^More ways to dismiss/ });
    expect(menu.hasAttribute("disabled")).toBe(true);
  });
});
