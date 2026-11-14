import { describe, expect, it } from "vitest";
import {
  type Check,
  checkSummary,
  orderChecks,
  orderReviewers,
  type Reviewer,
  reviewStatusOf,
} from "./pull-request-status.ts";

const reviewer = (id: string, verdict: Reviewer["verdict"]): Reviewer => ({
  id,
  name: id,
  team: false,
  verdict,
});

const check = (name: string, state: Check["state"]): Check => ({ name, state, url: null });

describe("reviewStatusOf", () => {
  it("is changes requested when anyone requested them, whoever approved", () => {
    expect(reviewStatusOf([reviewer("a", "approved"), reviewer("b", "changes-requested")])).toBe(
      "changes-requested",
    );
  });

  it("is approved when someone approved and nobody requested changes", () => {
    expect(reviewStatusOf([reviewer("a", "approved"), reviewer("b", "commented")])).toBe(
      "approved",
    );
  });

  it("is null with only comments, waiting reviewers or none", () => {
    expect(reviewStatusOf([reviewer("a", "commented"), reviewer("b", null)])).toBeNull();
    expect(reviewStatusOf([])).toBeNull();
  });
});

describe("orderReviewers", () => {
  it("puts changes requested first, then approved, commented and waiting, keeping order", () => {
    const ordered = orderReviewers([
      reviewer("waiting", null),
      reviewer("commented", "commented"),
      reviewer("approved-1", "approved"),
      reviewer("changes", "changes-requested"),
      reviewer("approved-2", "approved"),
    ]);
    expect(ordered.map((one) => one.id)).toEqual([
      "changes",
      "approved-1",
      "approved-2",
      "commented",
      "waiting",
    ]);
  });
});

describe("orderChecks", () => {
  it("puts failed first, then running, passed and skipped, each by name", () => {
    const ordered = orderChecks([
      check("lint", "passed"),
      check("e2e", "skipped"),
      check("unit", "failed"),
      check("build", "passed"),
      check("deploy", "running"),
    ]);
    expect(ordered.map((one) => one.name)).toEqual(["unit", "deploy", "build", "lint", "e2e"]);
  });
});

describe("checkSummary", () => {
  it("passes when every check that ran passed, not counting skipped ones", () => {
    expect(
      checkSummary([check("a", "passed"), check("b", "passed"), check("c", "skipped")]),
    ).toEqual({ state: "passed", total: 2, passed: 2, failed: 0, running: 0, skipped: 1 });
  });

  it("fails when any check failed, even with others running", () => {
    const summary = checkSummary([
      check("a", "failed"),
      check("b", "running"),
      check("c", "passed"),
    ]);
    expect(summary.state).toBe("failed");
    expect(summary.total).toBe(3);
  });

  it("runs while a check is running and none failed", () => {
    expect(checkSummary([check("a", "running"), check("b", "passed")]).state).toBe("running");
  });

  it("is skipped when every check was skipped, and null with none", () => {
    expect(checkSummary([check("a", "skipped")])).toMatchObject({ state: "skipped", total: 0 });
    expect(checkSummary([]).state).toBeNull();
  });
});
