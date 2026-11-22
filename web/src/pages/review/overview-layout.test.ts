import { describe, expect, it } from "vitest";
import type { OverviewNode } from "./overview.ts";
import { nodeWidth, shownLabel } from "./overview-layout.ts";

const node = (label: string, kind: OverviewNode["kind"] = "group", files = 2): OverviewNode => ({
  key: kind === "group" ? `group:${label.slice(0, -1)}` : label,
  kind,
  paths: Array.from({ length: files }, (_, at) => `${label}F${at}.java`),
  label,
  added: 10,
  deleted: 2,
  risk: "logic",
  generated: false,
  entries: [],
  flows: [],
  partIds: [],
  uses: 0,
  badges: [],
  row: 0,
});

describe("shownLabel", () => {
  it("keeps a label that fits", () => {
    expect(shownLabel(node("src/routes/"))).toBe("src/routes/");
    expect(shownLabel(node("routes/hosting_services.py", "file", 1))).toBe(
      "routes/hosting_services.py",
    );
  });

  it("cuts whole directories from a long path's middle, keeping its first and last", () => {
    const label = "src/test/java/com/acmecorp/fulfillment/orders/controllers/payments/";
    const shown = shownLabel(node(label));
    expect(shown).toBe("src/test/java/…/orders/controllers/payments/");
    expect(shown.length).toBeLessThan(label.length);
    expect(nodeWidth(node(label))).toBeLessThanOrEqual(380);
  });

  it("cuts a file name's words from its middle, never its extension", () => {
    const shown = shownLabel(
      node("InternalRecurringPaymentScheduleReconciliationSupportFactoryBean.java", "file", 1),
    );
    expect(shown).toMatch(/^Internal.*….*Bean\.java$/);
  });

  it("keeps the name and cuts the directories before it first", () => {
    const shown = shownLabel(
      node(
        "services/payment/recurring/internal/schedule/RecurringPaymentScheduler.java",
        "file",
        1,
      ),
    );
    expect(shown).toMatch(/^services\/.*…\/.*RecurringPaymentScheduler\.java$/);
  });
});
