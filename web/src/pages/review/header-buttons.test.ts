import { describe, expect, it } from "vitest";
import { type BarState, barButtons, OWN_PR, STALE_PR } from "./header-buttons.ts";

const state = (overrides: Partial<BarState> = {}): BarState => ({
  aiDone: false,
  running: false,
  pending: 0,
  isAuthor: false,
  stale: false,
  approved: false,
  ...overrides,
});

const filled = (state: BarState) => {
  const buttons = barButtons(state);
  return [
    ...(buttons.approve.filled ? ["approve"] : []),
    ...(buttons.publish.filled ? ["publish"] : []),
  ];
};

describe("barButtons", () => {
  it("fills nothing before Claude's run with nothing pending", () => {
    expect(filled(state())).toEqual([]);
    expect(barButtons(state()).order).toEqual(["approve", "publish"]);
  });

  it("fills Publish, last and with the count, while comments are pending", () => {
    for (const aiDone of [false, true]) {
      const buttons = barButtons(state({ aiDone, pending: 3 }));
      expect(filled(state({ aiDone, pending: 3 }))).toEqual(["publish"]);
      expect(buttons.publish.count).toBe(3);
      expect(buttons.order.at(-1)).toBe("publish");
    }
  });

  it("fills Approve, last, once Claude's run is done and nothing is pending", () => {
    const buttons = barButtons(state({ aiDone: true }));
    expect(filled(state({ aiDone: true }))).toEqual(["approve"]);
    expect(buttons.order).toEqual(["publish", "approve"]);
  });

  it("fills nothing while Claude runs again", () => {
    expect(filled(state({ aiDone: true, running: true }))).toEqual([]);
  });

  it("disables Approve on the reviewer's own PR, and fills nothing in its place", () => {
    const buttons = barButtons(state({ aiDone: true, isAuthor: true }));
    expect(buttons.approve.disabledReason).toBe(OWN_PR);
    expect(filled(state({ aiDone: true, isAuthor: true }))).toEqual([]);
  });

  it("disables Approve while the PR has commits the analysis hasn't read", () => {
    expect(barButtons(state({ aiDone: true, stale: true })).approve.disabledReason).toBe(STALE_PR);
    expect(filled(state({ aiDone: true, stale: true }))).toEqual([]);
    expect(filled(state({ stale: true, pending: 1 }))).toEqual(["publish"]);
  });

  it("turns Approve into Revoke approval, never filled, once the reviewer has approved", () => {
    const buttons = barButtons(state({ aiDone: true, approved: true }));
    expect(buttons.approve).toEqual({ filled: false, disabledReason: null, revoke: true });
    expect(filled(state({ aiDone: true, approved: true }))).toEqual([]);
    expect(buttons.order).toEqual(["approve", "publish"]);
    expect(filled(state({ approved: true, pending: 2 }))).toEqual(["publish"]);
  });

  it("lets the reviewer revoke an approval while the PR has new commits", () => {
    expect(barButtons(state({ approved: true, stale: true })).approve.disabledReason).toBeNull();
  });
});
