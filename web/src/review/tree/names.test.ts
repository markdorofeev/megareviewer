import { describe, expect, it } from "vitest";
import { shortenName, shortenPath, shortenRepoName, splitName } from "./names.ts";

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

describe("shortenPath", () => {
  it("keeps a path that fits", () => {
    expect(shortenPath("web/src/routes", upTo(20))).toBe("web/src/routes");
  });

  it("cuts the fewest directories from the middle, keeping where it starts and what it names", () => {
    const caption = "src/test/java/com/acmecorp/fulfillment/orders";
    expect(shortenPath(caption, upTo(43))).toBe("src/test/java/…/acmecorp/fulfillment/orders");
    expect(shortenPath(caption, upTo(34))).toBe("src/test/java/…/fulfillment/orders");
    expect(shortenPath(caption, upTo(20))).toBe("src/test/…/orders");
  });

  it("falls back to its last directory, which the row cuts if even that doesn't fit", () => {
    expect(shortenPath("packages/api-client/src/generated/models", upTo(14))).toBe("…/models");
    expect(shortenPath("packages/payments", upTo(5))).toBe("…/payments");
    expect(shortenPath("payments", upTo(5))).toBe("payments");
  });
});

describe("shortenRepoName", () => {
  it("keeps a name that fits", () => {
    expect(shortenRepoName("delphi-code", upTo(22))).toBe("delphi-code");
  });

  it("cuts whole segments from the middle, with the separator on both sides of the cut", () => {
    expect(shortenRepoName("delphi-payments-reconciliation-service", upTo(22))).toBe(
      "delphi-…-service",
    );
    expect(shortenRepoName("delphi-payments-reconciliation-service", upTo(26))).toBe(
      "delphi-payments-…-service",
    );
    expect(shortenRepoName("spring-boot-starter-data-elasticsearch-reactive", upTo(22))).toBe(
      "spring-boot-…-reactive",
    );
    expect(shortenRepoName("analytics_backend_service_v2_migration", upTo(22))).toBe(
      "analytics_…_migration",
    );
  });

  it("cuts as a file name is cut when segments can't", () => {
    expect(shortenRepoName("averyveryverylongname", upTo(12))).toBe("ave…longname");
    expect(shortenRepoName("short-averyveryverylongname", upTo(12))).toBe(
      shortenName("short-averyveryverylongname", upTo(12)),
    );
  });
});
