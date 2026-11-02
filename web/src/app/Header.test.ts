import { describe, expect, it } from "vitest";
import type { StatusResponse } from "../../../contracts/index.ts";
import { fixtureStatus } from "../../dev/fixtures/index.ts";
import { statusIndicator } from "./Header.tsx";

const withHosts = (hosts: Partial<StatusResponse["hosts"]>): StatusResponse => ({
  ...fixtureStatus,
  hosts: { ...fixtureStatus.hosts, ...hosts },
});

const off = { configured: false, user: null, error: null };

describe("statusIndicator", () => {
  it("is ready with a host", () => {
    expect(statusIndicator(fixtureStatus, null)).toEqual({
      tone: "ok",
      label: "Ready",
      detail: "megareviewer 0.0.0-mock",
    });
  });

  it("needs setup without a host, and is ready with the model off", () => {
    expect(statusIndicator(withHosts({ github: off }), null).label).toBe("Setup needed");
    expect(statusIndicator({ ...fixtureStatus, model: { enabled: false } }, null).label).toBe(
      "Ready",
    );
  });

  it("reports a host whose user lookup failed", () => {
    const failing = { configured: true, user: null, error: "401" };
    expect(statusIndicator(withHosts({ github: failing }), null).label).toBe("Host problem");
  });

  it("is connecting until the status arrives, and disconnected on an error", () => {
    expect(statusIndicator(null, null).label).toBe("Connecting…");
    expect(statusIndicator(null, { code: "unreachable", message: "Can't reach it." })).toEqual({
      tone: "danger",
      label: "Disconnected",
      detail: "Can't reach it.",
    });
  });
});
