import { describe, expect, it } from "vitest";
import { boxLabel, compactLabels } from "./tour-labels.ts";

describe("boxLabel", () => {
  it("splits a directory into its parents and its own name", () => {
    expect(boxLabel("src/routes/")).toEqual({ prefix: "src/", name: "routes" });
    expect(boxLabel("tests")).toEqual({ prefix: "", name: "tests" });
    expect(boxLabel("./")).toEqual({ prefix: "", name: "." });
  });

  it("cuts parents that don't fit from their middle, keeping the directory beside the name", () => {
    expect(boxLabel("substratevm/src/com.oracle.svm.hosted/pgo/")).toEqual({
      prefix: "…/com.oracle.svm.hosted/",
      name: "pgo",
    });
    expect(boxLabel("compiler/src/jdk.graal.compiler/phases/common/priorityinline/")).toEqual({
      prefix: "compiler/src/…/phases/common/",
      name: "priorityinline",
    });
  });
});

describe("compactLabels", () => {
  it("names each directory by as few of its last directories as tell it apart", () => {
    expect(
      compactLabels([
        "substratevm/src/com.oracle.svm.hosted/pgo/",
        "substratevm/src/com.oracle.svm.hosted/phases/priorityinline/",
        "substratevm/src/com.oracle.svm.core/pgo/",
        "substratevm/src/com.oracle.svm.core/thread/",
      ]),
    ).toEqual(["hosted/pgo", "priorityinline", "core/pgo", "thread"]);
  });

  it("keeps a module's whole name when no other on the strip shares its package", () => {
    expect(compactLabels(["src/com.acme.orders/api/", "src/web/api/"])).toEqual([
      "com.acme.orders/api",
      "web/api",
    ]);
  });

  it("keeps a lone directory's name, and names a directory the tour comes back to the same each time", () => {
    expect(compactLabels(["src/routes/"])).toEqual(["routes"]);
    expect(
      compactLabels(["svm/core/pgo/", "svm/core/thread/", "svm/core/pgo/", "svm/hosted/pgo/"]),
    ).toEqual(["core/pgo", "thread", "core/pgo", "hosted/pgo"]);
  });
});
