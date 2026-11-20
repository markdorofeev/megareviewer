import { describe, expect, it } from "vitest";
import { fileKind, folderKind } from "./file-kind.ts";

describe("fileKind", () => {
  it.each([
    ["src/main/java/com/acme/Orders.java", "modified", "class", false],
    ["src/test/java/com/acme/OrdersTest.java", "added", "class", true],
    ["src/main/java/com/acme/Legacy.java", "deleted", "java", false],
    ["app/build.gradle.kts", "modified", "kotlin", false],
    ["web/src/routes/setup.tsx", "modified", "typeScript", false],
    ["web/src/routes/setup.test.tsx", "modified", "typeScript", false],
    ["scripts/build.mjs", "modified", "javaScript", false],
    ["openapi.json", "modified", "json", false],
    ["config/app.yml", "modified", "yaml", false],
    ["CONTRIBUTING.md", "modified", "markdown", false],
    ["pom.xml", "modified", "xml", false],
    ["src/main/resources/app.properties", "modified", "properties", false],
    ["install.sh", "modified", "shell", false],
    ["delphi_code/hosts.py", "modified", "python", false],
    ["notes.txt", "modified", "text", false],
    ["src/META-INF/services/com.acme.Feature", "modified", "text", false],
    ["web/src/styles/globals.css", "modified", "unknown", false],
    ["LICENSE", "modified", "unknown", false],
  ] as const)("%s (%s) is %s", (path, status, icon, testMark) => {
    expect(fileKind(path, status)).toMatchObject({ icon, testMark });
  });

  it("says what the file is", () => {
    expect(fileKind("a/B.java").label).toBe("Java class");
    expect(fileKind("src/test/java/BTest.java").label).toBe("Java test class");
    expect(fileKind("a/B.java", "deleted").label).toBe("Java file");
    expect(fileKind("a.py").label).toBe("Python");
  });
});

describe("folderKind", () => {
  const paths = [
    "substratevm/src/com.oracle.svm.core/src/com/oracle/svm/core/pgo/A.java",
    "substratevm/src/com.oracle.svm.hosted/src/META-INF/services/x.Feature",
    "substratevm/mx.substratevm/suite.py",
    "orders/src/main/java/com/acme/orders/Order.java",
    "docs/reference-manual/native-image/PGO.md",
  ];

  it.each([
    ["substratevm/src/com.oracle.svm.core", "module"],
    ["substratevm/src/com.oracle.svm.core/pgo", "package"],
    ["substratevm/src/com.oracle.svm.core/src/com/oracle/svm/core/pgo", "package"],
    ["substratevm/src/com.oracle.svm.hosted/src/META-INF/services", "folder"],
    ["substratevm/mx.substratevm", "folder"],
    ["orders/src/main/java", "folder"],
    ["orders/src/main/java/com/acme/orders", "package"],
    ["docs/reference-manual/native-image", "folder"],
  ] as const)("%s is a %s", (path, kind) => {
    expect(folderKind(path, paths)).toBe(kind);
  });
});
