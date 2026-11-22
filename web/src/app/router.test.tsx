import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { PullRequestRef } from "../../../src/domain/review/index.ts";
import { fixtureAnalysisView } from "../../dev/fixtures/index.ts";
import { Link } from "./Link.tsx";
import {
  matchRoute,
  navigate,
  panelOf,
  preferencesPath,
  pullRequestPath,
  redirect,
  reviewPath,
  usePathname,
} from "./router.ts";

const id = fixtureAnalysisView.analysis.id;

afterEach(() => window.history.replaceState(null, "", "/"));

describe("matchRoute", () => {
  it("matches the picker and reviews", () => {
    expect(matchRoute("/")).toEqual({ page: "picker" });
    expect(matchRoute(`/review/${id}`)).toEqual({ page: "review", analysisId: id });
    expect(matchRoute(`/review/${id}/`)).toEqual({
      page: "review",
      analysisId: id,
    });
  });

  it("matches the preferences page", () => {
    expect(matchRoute("/preferences")).toEqual({ page: "preferences" });
    expect(matchRoute("/preferences/")).toEqual({ page: "preferences" });
    expect(matchRoute("/preferences/naming")).toEqual({ page: "not-found" });
  });

  it("names a preferences panel in the query, slashes as they are, and reads it back", () => {
    expect(preferencesPath(null)).toBe("/preferences");
    expect(preferencesPath("suggestions")).toBe("/preferences?scope=suggestions");
    const path = preferencesPath("github/acme/my shop");
    expect(path).toBe("/preferences?scope=github/acme/my%20shop");
    expect(panelOf(new URL(path, "http://x").search)).toBe("github/acme/my shop");
    expect(panelOf("")).toBeNull();
  });

  it("answers not-found for anything else", () => {
    for (const path of ["/nope", "/review", "/review/not-an-id", "/review/%E0%A4%A", "/dev/a/b"]) {
      expect(matchRoute(path)).toEqual({ page: "not-found" });
    }
  });

  it("builds review paths that match", () => {
    expect(matchRoute(reviewPath(id))).toEqual({ page: "review", analysisId: id });
  });

  it("matches a PR by its host, owner, repository and number, as a pasted link names it", () => {
    const ref: PullRequestRef = {
      repo: { host: "bitbucket", owner: "acme-team", repo: "billing.api" },
      number: 57,
    };
    expect(pullRequestPath(ref)).toBe("/pr/bitbucket/acme-team/billing.api/57");
    expect(matchRoute("/pr/bitbucket/acme-team/billing.api/57/")).toEqual({ page: "open", ref });
    expect(matchRoute("/pr/github/Acme/Shop/128")).toEqual({
      page: "open",
      ref: { repo: { host: "github", owner: "acme", repo: "shop" }, number: 128 },
    });
  });

  it("answers not-found for a PR path a link couldn't name", () => {
    for (const path of [
      "/pr/gitlab/acme/shop/1",
      "/pr/github/acme/shop/0",
      "/pr/github/acme/shop/012",
      "/pr/github/acme/shop/1e3",
      "/pr/github/acme/shop",
      "/pr/github/acme/shop/1/files",
      "/pr/github/%2e%2e/shop/1",
      "/pr/github/a%2Fb/shop/1",
      "/pr/github/acme/%E0%A4%A/1",
    ]) {
      expect(matchRoute(path)).toEqual({ page: "not-found" });
    }
  });
});

describe("navigation", () => {
  it("updates the pathname on navigate and on back", async () => {
    const { result } = renderHook(() => usePathname());
    act(() => navigate("/review/x"));
    expect(result.current).toBe("/review/x");
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    });
    expect(result.current).toBe("/");
  });

  it("replaces the current entry on redirect", () => {
    const { result } = renderHook(() => usePathname());
    const before = window.history.length;
    act(() => redirect("/review/y"));
    expect(result.current).toBe("/review/y");
    expect(window.history.length).toBe(before);
  });

  it("follows links in the app, but not modified clicks", async () => {
    render(<Link to="/review/x">Review</Link>);
    const link = screen.getByRole("link", { name: "Review" });
    expect(link.getAttribute("href")).toBe("/review/x");
    await userEvent.click(link);
    expect(window.location.pathname).toBe("/review/x");
  });
});
