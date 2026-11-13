import { describe, expect, it } from "vitest";
import {
  type DiffLine,
  type FileChange,
  type FileStatus,
  type Hunk,
  HunkId,
} from "../diff/index.ts";
import { classifyByRules, isTestFile, raiseByRules, ruleReasons } from "./index.ts";

const h = (n: number): HunkId => HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`);

/** Lines as in a diff: "+added", "-deleted", " context". */
const lines = (...texts: string[]): DiffLine[] =>
  texts.map((text, i) => {
    const kind = text.startsWith("+") ? "add" : text.startsWith("-") ? "del" : "context";
    return {
      kind,
      oldLine: kind === "add" ? null : i + 1,
      newLine: kind === "del" ? null : i + 1,
      text: text.slice(1),
      noNewlineAtEnd: false,
    };
  });

const hunk = (id: HunkId, path: string, body: readonly DiffLine[]): Hunk => ({
  id,
  path,
  oldStart: 1,
  oldLines: body.filter((line) => line.kind !== "add").length,
  newStart: 1,
  newLines: body.filter((line) => line.kind !== "del").length,
  sectionHeading: null,
  lines: body,
});

const file = (
  path: string,
  hunks: readonly { readonly id: HunkId; readonly body: readonly DiffLine[] }[],
  options: { readonly status?: FileStatus; readonly oldPath?: string } = {},
): FileChange => ({
  path,
  oldPath: options.oldPath ?? null,
  status: options.status ?? "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language: null,
  hunks: hunks.map(({ id, body }) => hunk(id, path, body)),
  additions: 0,
  deletions: 0,
});

/** The risk of a file's only hunk, which adds one plain line unless given lines. */
const riskOf = (path: string, body = lines("+const x = 1;"), status?: FileStatus) => {
  const [assessment] = classifyByRules([file(path, [{ id: h(1), body }], { status })], new Set());
  return assessment;
};

const reasonOf = (path: string, body?: DiffLine[], status?: FileStatus): string | null => {
  const assessment = riskOf(path, body, status);
  return assessment?.riskClass === "contract" ? assessment.reason : null;
};

describe("classifyByRules", () => {
  it("marks a hunk no rule matches as logic", () => {
    expect(riskOf("src/review/tour.ts")).toEqual({
      hunkId: h(1),
      riskClass: "logic",
      reason: "No contract rule matched.",
      source: "rule",
    });
  });

  it.each([
    ["package.json", "changes dependencies (package.json)"],
    ["packages/web/package.json", "changes dependencies (package.json)"],
    ["go.mod", "changes dependencies (go.mod)"],
    ["requirements-dev.txt", "changes dependencies (requirements-dev.txt)"],
    ["src/App/App.csproj", "changes dependencies (App.csproj)"],
    ["db/schema.sql", "changes a schema or migration"],
    ["prisma/schema.prisma", "changes a schema or migration"],
    ["api/user.proto", "changes a schema or migration"],
    ["db/migrations/014_add_users.rb", "changes a schema or migration"],
    ["docs/openapi.yaml", "changes a schema or migration"],
    [".github/workflows/ci.yml", "changes CI or infrastructure"],
    ["bitbucket-pipelines.yml", "changes CI or infrastructure"],
    ["Dockerfile", "changes CI or infrastructure"],
    ["deploy/api.Dockerfile", "changes CI or infrastructure"],
    ["docker-compose.prod.yml", "changes CI or infrastructure"],
    ["infra/main.tf", "changes CI or infrastructure"],
    [".env.example", "changes repository config (.env.example)"],
    [".npmrc", "changes repository config (.npmrc)"],
    [".github/CODEOWNERS", "changes repository config (CODEOWNERS)"],
    [".gitattributes", "changes repository config (.gitattributes)"],
    ["tsconfig.build.json", "changes repository config (tsconfig.build.json)"],
    ["config/app.yaml", "changes app config (app.yaml)"],
    ["deploy/settings/prod.toml", "changes app config (prod.toml)"],
    ["src/main/resources/application.properties", "changes app config (application.properties)"],
    ["src/auth/index.ts", "auth or security path"],
    ["src/api/verifySession.ts", "auth or security path"],
    ["src/OAuthClient.ts", "auth or security path"],
    ["lib/JWTToken.go", "auth or security path"],
    ["app/permissions_controller.rb", "auth or security path"],
    ["src/middleware/require-admin.ts", "auth or security path"],
    ["delphi_code/infrastructure/keychain.py", "auth or security path"],
    ["src/KeyringStore.ts", "auth or security path"],
  ])("marks %s as contract: %s", (path, reason) => {
    expect(reasonOf(path)).toBe(reason);
  });

  it.each([
    "package.json.bak",
    "docs/package-json.md",
    "src/sql/builder.ts",
    "src/migrator.ts",
    ".github/ISSUE_TEMPLATE/bug.yml",
    "docs/docker.md",
    "src/environment.ts",
    "src/config/defaults.ts",
    "fixtures/app.yaml",
    "src/authors.ts",
    "src/tokenizer.ts",
    "src/sessionless/index.ts",
    "src/catalog/oauthorize-later.ts",
    "src/keychainless.ts",
  ])("leaves %s as logic", (path) => {
    expect(reasonOf(path)).toBeNull();
  });

  it("lists every matching rule once, in rule order", () => {
    const body = lines("+  install(a)");
    expect(reasonOf("src/auth/package.json", body)).toBe(
      "changes dependencies (package.json); auth or security path",
    );
  });

  it("matches a renamed file by its old path", () => {
    const moved = file("src/lib/helpers.ts", [{ id: h(1), body: lines("+x();") }], {
      status: "renamed",
      oldPath: "src/auth/helpers.ts",
    });
    expect(classifyByRules([moved], new Set())[0]?.reason).toBe("auth or security path");
  });

  it("skips mechanical hunks, even in a file a path rule matches", () => {
    const manifest = file("package.json", [
      { id: h(1), body: lines('+  "a": "1.0.0",') },
      { id: h(2), body: lines('+  "b": "2.0.0",') },
    ]);
    expect(classifyByRules([manifest], new Set([h(1)])).map((risk) => risk.hunkId)).toEqual([h(2)]);
  });

  it("gives one assessment per hunk, in file and hunk order", () => {
    const files = [
      file("src/b.ts", [{ id: h(3), body: lines("+b();") }]),
      file("src/auth/c.ts", [{ id: h(1), body: lines("+c();") }]),
      file("src/a.ts", [{ id: h(2), body: lines("+a();") }]),
    ];
    expect(classifyByRules(files, new Set()).map((risk) => [risk.hunkId, risk.riskClass])).toEqual([
      [h(3), "logic"],
      [h(1), "contract"],
      [h(2), "logic"],
    ]);
  });

  it("never marks a hunk mechanical and covers every hunk without a proof, over random PRs", () => {
    // A small seeded generator, so a failure reproduces.
    let seed = 42;
    const next = (max: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 16) % max;
    };
    const paths = [
      "package.json",
      "src/auth/a.ts",
      "src/a.ts",
      "src/a.test.ts",
      "db/x.sql",
      "README.md",
    ];
    const texts = ["+eval(x);", '-it("x", () => {', '+it.skip("x");', "+plain();", " context();"];
    for (let run = 0; run < 200; run += 1) {
      const files = Array.from({ length: 1 + next(5) }, (_, f) =>
        file(
          `${f}/${paths[next(paths.length)] ?? "x.ts"}`,
          Array.from({ length: 1 + next(3) }, (_, i) => ({
            id: h(f * 10 + i + 1),
            body: lines(
              ...Array.from({ length: 1 + next(4) }, () => texts[next(texts.length)] ?? "+x"),
            ),
          })),
          { status: next(6) === 0 ? "deleted" : "modified" },
        ),
      );
      const all = files.flatMap((f) => f.hunks.map((one) => one.id));
      const mechanical = new Set(all.filter(() => next(3) === 0));
      const risk = classifyByRules(files, mechanical);

      expect(risk.map((one) => one.hunkId)).toEqual(all.filter((one) => !mechanical.has(one)));
      expect(risk.every((one) => one.riskClass !== "mechanical" && one.source === "rule")).toBe(
        true,
      );
    }
  });
});

describe("isTestFile", () => {
  it.each([
    "src/a.test.ts",
    "src/a.spec.tsx",
    "pkg/a_test.go",
    "spec/models/user_spec.rb",
    "tests/test_login.py",
    "test_login.py",
    "src/test/java/LoginTest.java",
    "app/src/LoginTests.kt",
    "src/__tests__/a.ts",
    "test/fixtures/data.json",
  ])("knows %s is a test file", (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  it.each([
    "src/testing.ts",
    "src/latest.ts",
    "src/contest/a.ts",
    "src/Tester.java",
    "src/spec.md",
  ])("knows %s isn't", (path) => {
    expect(isTestFile(path)).toBe(false);
  });
});

describe("raiseByRules", () => {
  const assessed = (n: number, riskClass: "logic" | "contract" | "mechanical", reason: string) => ({
    hunkId: h(n),
    riskClass,
    reason,
    source: "model" as const,
  });
  const rule = (n: number, riskClass: "logic" | "contract", reason: string) => ({
    hunkId: h(n),
    riskClass,
    reason,
    source: "rule" as const,
  });

  it("keeps the model's class unless a rule says contract", () => {
    const model = [
      assessed(1, "logic", "m1"),
      assessed(2, "contract", "m2"),
      assessed(3, "logic", "m3"),
    ];
    const rules = [rule(1, "contract", "r1"), rule(2, "contract", "r2"), rule(3, "logic", "r3")];

    expect(raiseByRules(model, rules)).toEqual([
      rule(1, "contract", "r1"),
      assessed(2, "contract", "m2"),
      assessed(3, "logic", "m3"),
    ]);
  });

  it("leaves hunks the rules didn't assess alone", () => {
    const model = [assessed(1, "mechanical", "moved")];
    expect(raiseByRules(model, [rule(2, "contract", "r")])).toEqual(model);
  });
});

describe("rules that read no names", () => {
  // Names don't say what a check guards or what a response exposes: these were line rules, and
  // each one both missed real risk and marked harmless code. Only the path decides now.
  it.each([
    "+save_secret(domain, value)",
    '+@router.put("/accounts/{domain}/token")',
    "+const value = eval(input);",
    "+run(command, shell=True)",
    "-    if order.owner_id != user.id:",
  ])("leaves %s outside a security path as logic", (text) => {
    expect(reasonOf("src/service.py", lines(text))).toBeNull();
  });

  it("leaves a deleted or skipped test as logic", () => {
    expect(reasonOf("src/a.test.ts", lines('-  it("rejects a forged token", () => {'))).toBeNull();
    expect(reasonOf("src/a.test.ts", lines('+  it.skip("x", () => {'))).toBeNull();
    expect(reasonOf("src/a.test.ts", undefined, "deleted")).toBeNull();
  });

  describe("a security path's inert changes", () => {
    it.each([
      [
        "delphi_code/infrastructure/keychain.py",
        lines(
          "+import shutil",
          "+import subprocess",
          "+from ..domain.errors import Failure, FailureKind",
          "+",
          '+KEYCHAIN_SERVICE = "delphi-code"',
          "+KEYCHAIN_TIMEOUT_SECONDS = 30",
          "+KEYCHAIN_MISSING_MESSAGE = (",
          '+    "Saving a token needs the macOS keychain; "',
          '+    "set the token in the environment instead"',
          "+)",
          "+# Tokens never go to disk.",
        ),
      ],
      [
        "web/src/picker/CredentialsGuide.tsx",
        lines(
          '+import { Link } from "@tanstack/react-router";',
          "+",
          "         <li>",
          "+          <li>",
          '+            Paste a token on the{" "}',
          '+            <Link to="/setup" className="underline underline-offset-4">',
          "+              Setup page",
          "+            </Link>",
          "+          </li>",
        ),
      ],
    ])("leaves %s alone", (path, body) => {
      expect(reasonOf(path, body)).toBeNull();
    });

    it.each([
      "+  if (!session) return;",
      "+    return None",
      "+SECRET_KEY = os.environ['SECRET_KEY']",
      "+const token = 1;",
      "-    raise Unauthorized()",
      "+            <Link to={next}>",
      "+            {token}",
      "+    return",
      "+  else",
    ])("keeps %s contract", (line) => {
      expect(reasonOf("src/auth/guard.tsx", lines(line))).toBe("auth or security path");
    });

    it("keeps plain text contract outside markup", () => {
      expect(reasonOf("src/auth/session.py", lines("+    return None"))).toBe(
        "auth or security path",
      );
    });
  });

  it("keeps a guide on a security path contract", () => {
    expect(reasonOf("docs/credentials.md")).toBe("auth or security path");
  });

  it.each([
    "tests/fake_keychain.py",
    "src/auth/session.test.ts",
    "src/testing/fake_keychain.py",
    "web/src/auth/mock-session.ts",
  ])("leaves test code on a security path alone: %s", (path) => {
    expect(reasonOf(path)).toBeNull();
  });
});

describe("ruleReasons", () => {
  it("are the reasons classifyByRules joins for a hunk", () => {
    const changed = file("src/auth/session.py", [{ id: h(1), body: lines("+    return None") }]);
    const [whole] = changed.hunks;
    if (whole === undefined) throw new Error("no hunk");
    expect(ruleReasons(whole, changed).join("; ")).toBe(
      classifyByRules([changed], new Set())[0]?.reason,
    );
  });

  it("drop a security path from a part whose own lines are inert", () => {
    const body = lines('+KEYCHAIN_SERVICE = "delphi-code"', "+def save(self):", "+    run(self)");
    const changed = file("app/keychain.py", [{ id: h(1), body }]);
    const [whole] = changed.hunks;
    if (whole === undefined) throw new Error("no hunk");
    expect(ruleReasons({ ...whole, lines: whole.lines.slice(0, 1) }, changed)).toEqual([]);
    expect(ruleReasons({ ...whole, lines: whole.lines.slice(1) }, changed)).toEqual([
      "auth or security path",
    ]);
  });

  it("keep a path rule's reason for every part of the file", () => {
    const manifest = file("package.json", [{ id: h(2), body: lines('+  "x": "1"') }]);
    const [only] = manifest.hunks;
    if (only === undefined) throw new Error("no hunk");
    expect(ruleReasons(only, manifest)).not.toEqual([]);
  });
});
