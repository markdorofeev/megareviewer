import { describe, expect, it } from "vitest";
import {
  type BarState,
  barButtons,
  OWN_PR,
  STALE_PR,
  verdictAfter,
  verdictLabel,
} from "./header-buttons.ts";

const state = (overrides: Partial<BarState> = {}): BarState => ({
  aiDone: false,
  running: false,
  pending: 0,
  isAuthor: false,
  stale: false,
  verdict: null,
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

  it("shows only Revoke approval once the reviewer has approved and nothing waits", () => {
    const buttons = barButtons(state({ aiDone: true, verdict: "approved" }));
    expect(buttons.approve).toEqual({ filled: false, disabledReason: null, revoke: true });
    expect(buttons.order).toEqual(["approve"]);
  });

  it("brings Publish back, filled and last, beside Revoke once comments wait", () => {
    const buttons = barButtons(state({ aiDone: true, verdict: "approved", pending: 2 }));
    expect(buttons.order).toEqual(["approve", "publish"]);
    expect(filled(state({ verdict: "approved", pending: 2 }))).toEqual(["publish"]);
    expect(buttons.approve.revoke).toBe(true);
  });

  it("lets the reviewer revoke an approval while the PR has new commits", () => {
    expect(
      barButtons(state({ verdict: "approved", stale: true })).approve.disabledReason,
    ).toBeNull();
  });

  it("fills Approve after a comment, but not after the reviewer requested changes", () => {
    expect(filled(state({ aiDone: true, verdict: "commented" }))).toEqual(["approve"]);
    const blocked = barButtons(state({ aiDone: true, verdict: "changes-requested" }));
    expect(filled(state({ aiDone: true, verdict: "changes-requested" }))).toEqual([]);
    expect(blocked.order).toEqual(["approve", "publish"]);
    expect(blocked.approve.disabledReason).toBeNull();
  });
});

describe("verdictLabel", () => {
  const receipt = {
    url: "https://github.com/acme/shop/pull/1#r1",
    publishedAt: "",
    postedCommentIds: {},
  };

  it("says the host's verdict, linking to the latest review published here", () => {
    expect(verdictLabel("approved", true, receipt)).toEqual({ kind: "approved", url: receipt.url });
    expect(verdictLabel("commented", true, null)).toEqual({ kind: "commented", url: null });
  });

  it("says nothing when the host knows no verdict of the reviewer's, a revoked one say", () => {
    expect(verdictLabel(null, true, receipt)).toBeNull();
  });

  it("falls back to Published while the host's verdict is unknown", () => {
    expect(verdictLabel(null, false, receipt)).toEqual({ kind: "published", url: receipt.url });
    expect(verdictLabel(null, false, null)).toBeNull();
  });
});

describe("verdictAfter", () => {
  it("takes the published verdict, and a comment leaves an earlier one standing", () => {
    expect(verdictAfter("approve", null)).toBe("approved");
    expect(verdictAfter("request_changes", "approved")).toBe("changes-requested");
    expect(verdictAfter("comment", "approved")).toBe("approved");
    expect(verdictAfter("comment", null)).toBe("commented");
  });
});
