import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureAnalysisView } from "../../dev/fixtures/index.ts";
import { Link } from "./Link.tsx";
import { matchRoute, navigate, reviewPath, usePathname } from "./router.ts";

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

  it("answers not-found for anything else", () => {
    for (const path of ["/nope", "/review", "/review/not-an-id", "/review/%E0%A4%A", "/dev/a/b"]) {
      expect(matchRoute(path)).toEqual({ page: "not-found" });
    }
  });

  it("builds review paths that match", () => {
    expect(matchRoute(reviewPath(id))).toEqual({ page: "review", analysisId: id });
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

  it("follows links in the app, but not modified clicks", async () => {
    render(<Link to="/review/x">Review</Link>);
    const link = screen.getByRole("link", { name: "Review" });
    expect(link.getAttribute("href")).toBe("/review/x");
    await userEvent.click(link);
    expect(window.location.pathname).toBe("/review/x");
  });
});
