import { describe, expect, it } from "vitest";
import { shortenName, splitName } from "./names.ts";

/** Fits when it has at most `length` characters. */
const upTo = (length: number) => (text: string) => text.length <= length;

describe("shortenName", () => {
  it("keeps a name that fits", () => {
    expect(shortenName("VMThreads", upTo(20))).toBe("VMThreads");
  });

  it("cuts the fewest whole words from the middle", () => {
    expect(shortenName("RecurringCallbackSupport", upTo(18))).toBe("Recurring…Support");
    expect(shortenName("HostedRuntimeConfigurationBuilder", upTo(22))).toBe(
      "HostedRuntime…Builder",
    );
    expect(shortenName("CEntryPointCallStubSupport", upTo(24))).toBe("CEntryPoint…StubSupport");
  });

  it("counts dots as words, so a service file loses its middle packages", () => {
    expect(shortenName("com.oracle.svm.core.feature.InternalFeature", upTo(20))).toBe(
      "com.…InternalFeature",
    );
  });

  it("cuts characters when words can't, keeping the end", () => {
    expect(shortenName("averyveryverylongname", upTo(12))).toBe("ave…longname");
  });

  it("returns its last try when nothing fits", () => {
    expect(shortenName("SubstrateGraphBuilderPhase", () => false).length).toBeLessThan(26);
  });
});

describe("splitName", () => {
  it.each([
    ["ProfileReader.java", ["ProfileReader", ".java"]],
    ["iprof-schema.json", ["iprof-schema", ".json"]],
    ["setup.test.tsx", ["setup.test", ".tsx"]],
    ["LICENSE", ["LICENSE", ""]],
    [".gitignore", [".gitignore", ""]],
    [
      "com.oracle.svm.core.feature.InternalFeature",
      ["com.oracle.svm.core.feature.InternalFeature", ""],
    ],
  ] as const)("%s", (name, parts) => {
    expect(splitName(name)).toEqual(parts);
  });
});
