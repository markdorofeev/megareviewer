import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PointId } from "../../../../src/domain/review/index.ts";
import { type Landing, readyTitle, useLanding } from "./useLanding.ts";

const f1 = PointId.parse("f1");
const f2 = PointId.parse("f2");
const d1 = PointId.parse("d1");

const TOKENS = { "--landing-total": "1100ms", "--landing-step-code": "60ms" } as const;
const setTokens = (tokens: Readonly<Record<string, string>>) => {
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(name, value);
  }
};

/** A page with a fold per point, where `below` are under the window. */
const Page = ({
  running,
  ids,
  below = [],
  seen,
}: {
  readonly running: boolean;
  readonly ids: readonly PointId[];
  readonly below?: readonly PointId[];
  readonly seen: (landing: Landing) => void;
}) => {
  const landing = useLanding(running, ids);
  seen(landing);
  return (
    <div data-landing={landing.phase}>
      {ids.map((id) => (
        <div
          key={id}
          data-slot="point-fold"
          data-point-id={id}
          data-fresh={landing.fresh(id) || undefined}
          ref={(element) => {
            if (element !== null && below.includes(id)) {
              element.getBoundingClientRect = () =>
                DOMRect.fromRect({ y: window.innerHeight + 10 });
            }
          }}
        />
      ))}
    </div>
  );
};

const play = (options: {
  ids: readonly PointId[];
  below?: readonly PointId[];
  before?: readonly PointId[];
}) => {
  const phases: Landing[] = [];
  const seen = (landing: Landing) => phases.push(landing);
  const view = render(<Page running={false} ids={options.before ?? []} seen={seen} />);
  view.rerender(<Page running={true} ids={options.before ?? []} seen={seen} />);
  view.rerender(<Page running={false} ids={options.ids} below={options.below ?? []} seen={seen} />);
  const last = (): Landing => {
    const landing = phases.at(-1);
    if (landing === undefined) throw new Error("the page never rendered");
    return landing;
  };
  return { phases, last, view };
};

describe("useLanding", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("style");
  });

  it("is at rest on an analysis opened with its results", () => {
    setTokens(TOKENS);
    const phases: Landing[] = [];
    render(<Page running={false} ids={[f1, d1]} seen={(landing) => phases.push(landing)} />);
    expect(phases.map((landing) => landing.phase)).toEqual(["done"]);
    expect(phases.at(-1)?.fresh(f1)).toBe(false);
    expect(document.querySelector("[data-landing]")?.getAttribute("data-landing")).toBe("done");
  });

  it("lands once when the run ends: measures, plays, then rests", () => {
    setTokens(TOKENS);
    const { phases, last } = play({ ids: [f1, f2, d1], below: [d1] });
    // The measuring render shows the run as still going, and is never painted.
    const measure = phases.find((landing) => landing.phase === "measure");
    expect(measure?.running).toBe(true);
    expect(last().phase).toBe("landing");
    expect(last().running).toBe(false);
    // In the window, top to bottom; the one below it is simply in place.
    expect([...last().inView]).toEqual([
      [f1, 0],
      [f2, 1],
    ]);
    expect(last().fresh(d1)).toBe(true);

    // The total, and a step for each card in view after the first.
    act(() => vi.advanceTimersByTime(1100 + 60 - 1));
    expect(last().phase).toBe("landing");
    act(() => vi.advanceTimersByTime(1));
    expect(last().phase).toBe("done");
    expect(last().inView.size).toBe(0);
    expect(last().fresh(f1)).toBe(false);
  });

  it("doesn't land the points the page showed before the run", () => {
    setTokens(TOKENS);
    const { last } = play({ before: [f1], ids: [f1, d1] });
    expect(last().fresh(f1)).toBe(false);
    expect([...last().inView]).toEqual([[d1, 0]]);
  });

  it("goes straight to rest under reduced motion, where the tokens are 0 ms", () => {
    setTokens({ "--landing-total": "0ms" });
    const { phases, last } = play({ ids: [f1] });
    expect(last().phase).toBe("done");
    expect(phases.some((landing) => landing.phase === "landing")).toBe(false);
  });

  it("says in the title that Claude is done, while the tab is hidden", () => {
    setTokens(TOKENS);
    document.title = "megareviewer";
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    play({ ids: [f1] });
    expect(document.title).toBe(`${readyTitle("Claude")} · megareviewer`);
    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(document.title).toBe("megareviewer");
    hidden.mockRestore();
  });
});
