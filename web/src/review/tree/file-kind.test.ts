import { describe, expect, it } from "vitest";
import { fileFamily, fileRole } from "./file-kind.ts";

describe("fileRole", () => {
  it.each([
    ["src/services/application.py", "code"],
    ["web/src/routes/setup.tsx", "code"],
    ["web/src/routes/setup.test.tsx", "test"],
    ["tests/fake_keychain.py", "test"],
    ["openapi.json", "data"],
    ["config/app.yaml", "data"],
    ["CONTRIBUTING.md", "docs"],
    ["web/src/styles/globals.css", "style"],
    ["LICENSE", "other"],
    ["assets/logo.png", "other"],
  ])("%s is %s", (path, role) => {
    expect(fileRole(path)).toBe(role);
  });
});

describe("fileFamily", () => {
  it.each([
    ["src/hosts.py", "python"],
    ["tests/test_picker.py", "python"],
    ["web/src/api/schema.d.ts", "script"],
    ["web/src/routes/setup.test.tsx", "script"],
    ["openapi.json", "data"],
    ["index.html", "markup"],
    ["web/src/styles/globals.css", "markup"],
    ["CONTRIBUTING.md", "plain"],
    ["cmd/main.go", "plain"],
    ["LICENSE", "plain"],
  ])("%s is %s", (path, family) => {
    expect(fileFamily(path)).toBe(family);
  });
});
