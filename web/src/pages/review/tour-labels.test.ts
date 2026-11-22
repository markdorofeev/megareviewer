import { describe, expect, it } from "vitest";
import { boxLabel, chipLabels, compactLabels } from "./tour-labels.ts";

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

describe("chipLabels", () => {
  it("keeps a path that fits, and cuts a longer one from its middle", () => {
    expect(
      chipLabels([
        "substratevm/mx.substratevm/",
        "substratevm/src/com.oracle.svm.hosted.test/src/com/oracle/svm/core/pgo/",
      ]),
    ).toEqual(["substratevm/mx.substratevm", "substratevm/src/…/svm/core/pgo"]);
  });

  it("keeps the whole of two paths the cut would make read alike", () => {
    const alike = [
      "substratevm/src/com.oracle.svm.hosted.test/src/com/oracle/svm/core/pgo/",
      "substratevm/src/com.oracle.svm.test/src/com/oracle/svm/core/pgo/",
    ];
    expect(chipLabels(alike)).toEqual(alike.map((label) => label.slice(0, -1)));
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
    ).toEqual(["com.oracle.svm.hosted/pgo", "priorityinline", "com.oracle.svm.core/pgo", "thread"]);
  });

  it("keeps a lone directory's name, and the whole of two that never differ", () => {
    expect(compactLabels(["src/routes/"])).toEqual(["routes"]);
    expect(compactLabels(["a/b/", "a/b/"])).toEqual(["a/b", "a/b"]);
  });
});
