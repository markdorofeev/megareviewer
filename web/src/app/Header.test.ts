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

  it("needs setup without a host, and is ready without Claude", () => {
    expect(statusIndicator(withHosts({ github: off }), null).label).toBe("Setup needed");
    const unavailable = { available: false, via: null, reason: "Claude Code isn't installed" };
    expect(statusIndicator({ ...fixtureStatus, model: unavailable }, null).label).toBe("Ready");
  });

  it("names a host whose user lookup failed, with its reason", () => {
    const failing = { configured: true, user: null, error: "Bitbucket refused the request." };
    expect(statusIndicator(withHosts({ bitbucket: failing }), null)).toEqual({
      tone: "warning",
      label: "Bitbucket problem",
      detail: "Bitbucket: Bitbucket refused the request.\nmegareviewer 0.0.0-mock",
    });
  });

  it("names both hosts when both fail", () => {
    const failing = { configured: true, user: null, error: "401" };
    expect(statusIndicator(withHosts({ github: failing, bitbucket: failing }), null)).toEqual({
      tone: "warning",
      label: "GitHub and Bitbucket problems",
      detail: "GitHub: 401\nBitbucket: 401\nmegareviewer 0.0.0-mock",
    });
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
