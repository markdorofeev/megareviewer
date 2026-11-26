import { describe, expect, it } from "vitest";
import { cameFrom, layoutOfSearch, layoutUrl } from "./useLayout.ts";

describe("layoutOfSearch", () => {
  it("reads the layout a review's address names, and nothing else", () => {
    expect(layoutOfSearch("?view=code")).toBe("map");
    expect(layoutOfSearch("?view=overview")).toBe("overview");
    expect(layoutOfSearch("?view=map")).toBeUndefined();
    expect(layoutOfSearch("")).toBeUndefined();
  });
});

describe("layoutUrl", () => {
  it("names the layout and keeps the rest of the query", () => {
    expect(layoutUrl({ pathname: "/review/a_1", search: "" }, "overview")).toBe(
      "/review/a_1?view=overview",
    );
    expect(layoutUrl({ pathname: "/review/a_1", search: "?view=overview&x=1" }, "map")).toBe(
      "/review/a_1?view=code&x=1",
    );
  });
});

describe("cameFrom", () => {
  it("reads where an entry came from, whatever else it holds", () => {
    expect(cameFrom({ from: "overview", scrollY: 40 })).toEqual({ from: "overview" });
    expect(cameFrom({ from: "code", at: "group:src/routes" })).toEqual({
      from: "code",
      at: "group:src/routes",
    });
    expect(cameFrom({ from: "code", at: null })).toEqual({ from: "code", at: null });
    expect(cameFrom({ from: "code", step: 3 })).toEqual({ from: "code", step: 3 });
  });

  it("is null for an entry the review didn't push", () => {
    expect(cameFrom(null)).toBeNull();
    expect(cameFrom({ scrollY: 40 })).toBeNull();
    expect(cameFrom({ from: "elsewhere" })).toBeNull();
  });
});
