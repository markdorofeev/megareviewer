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

  it.each([
    ["+const value = eval(input);", "adds eval()"],
    ["+  window.eval (code)", "adds eval()"],
    ["+const run = new Function('a', body);", "adds new Function()"],
    ["+el.innerHTML = html;", "adds innerHTML"],
    ["+node.insertAdjacentHTML('beforeend', html);", "adds insertAdjacentHTML"],
    ["+document.writeln(x);", "adds document.write()"],
    ["+<div dangerouslySetInnerHTML={{ __html: x }} />", "adds dangerouslySetInnerHTML"],
    ["+const agent = new Agent({ rejectUnauthorized: false });", "adds rejectUnauthorized: false"],
    ['+process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";', "adds NODE_TLS_REJECT_UNAUTHORIZED"],
    ["+requests.get(url, verify=False)", "adds verify=False"],
    ["+cfg := &tls.Config{InsecureSkipVerify: true}", "adds InsecureSkipVerify"],
    ["+  git commit --no-verify -m wip", "adds --no-verify"],
    ["+    found = subprocess.run(['security', 'find-generic-password'])", "adds subprocess"],
    ["+const out = child_process.execSync(command);", "adds child_process"],
    ["+os.system(command)", "adds os.system()"],
    ["+pipe = os.popen(command)", "adds os.popen()"],
    ["+run(command, shell=True)", "adds shell=True"],
  ])("marks an added %s as contract", (line, reason) => {
    expect(reasonOf("src/app.ts", lines(line))).toBe(reason);
  });

  it.each([
    "+const score = evaluate(input);",
    "+const doc = retrieval(query);",
    "+const fn = createFunction(body);",
    "+const html = el.innerHTMLish;",
    "+const agent = new Agent({ rejectUnauthorized: true });",
    "+requests.get(url, verify=True)",
    "+cfg := &tls.Config{InsecureSkipVerify: false}",
    "+const noVerify = flags['--no-verifyx'];",
    "+import subprocessing",
    "+import subprocess",
    "+from subprocess import run",
    '+import { exec } from "node:child_process";',
    '+const { exec } = require("child_process");',
    "+chaos.system(x)",
    "+run(command, shell=False)",
  ])("leaves an added %s as logic", (line) => {
    expect(reasonOf("src/app.ts", lines(line))).toBeNull();
  });

  it("looks only at added lines for dangerous calls", () => {
    expect(reasonOf("src/app.ts", lines("-el.innerHTML = html;", "+el.textContent = text;"))).toBe(
      null,
    );
    expect(reasonOf("src/app.ts", lines(" el.innerHTML = html;", "+log(html);"))).toBeNull();
  });

  it("names every dangerous call in a hunk in one reason", () => {
    expect(reasonOf("src/app.ts", lines("+eval(a);", "+el.innerHTML = b;", "+eval(c);"))).toBe(
      "adds eval(), innerHTML",
    );
  });

  describe("tests", () => {
    it("marks a deleted test file as removing tests", () => {
      expect(reasonOf("src/a.test.ts", lines("-const x = 1;"), "deleted")).toBe("removes tests");
    });

    it.each([
      '-  it("rejects a forged token", () => {',
      '-  test.each(cases)("parses %s", (c) => {',
      '-describe("session", () => {',
      "-def test_login(client):",
      "-func TestLogin(t *testing.T) {",
      "-  @Test",
    ])("marks a hunk that deletes %s as removing tests", (line) => {
      expect(reasonOf("src/a.test.ts", lines(line, "-  expect(x).toBe(1);"))).toBe("removes tests");
    });

    it("counts a split part's deleted test against its whole hunk", () => {
      const test = file("tests/test_picker.py", [
        {
          id: h(1),
          body: lines(
            "-def test_only_configured_hosts_are_offered(self):",
            "-    pass",
            "+def test_saved_tokens_come_first(self):",
            "+    pass",
            "+def test_only_hosts_with_credentials_are_offered(self):",
            "+    pass",
          ),
        },
      ]);
      const [whole] = test.hunks;
      if (whole === undefined) throw new Error("no hunk");
      // The part holding only the deleted test: one fewer there, two more in the hunk.
      const part = { ...whole, lines: whole.lines.slice(0, 2) };
      expect(ruleReasons(part, test, whole)).toEqual([]);
      const net = file("tests/test_picker.py", [
        { id: h(2), body: lines("-def test_a(self):", "-def test_c(self):", "+def test_b(self):") },
      ]);
      const [loses] = net.hunks;
      if (loses === undefined) throw new Error("no hunk");
      expect(ruleReasons({ ...loses, lines: loses.lines.slice(0, 2) }, net, loses)).toEqual([
        "removes tests",
      ]);
      // A part without a deleted test isn't the one that removes it.
      expect(ruleReasons({ ...loses, lines: loses.lines.slice(2) }, net, loses)).toEqual([]);
    });

    it("doesn't count a renamed test", () => {
      expect(
        reasonOf("src/a.test.ts", lines('-  it("does x", () => {', '+  it("does y", () => {')),
      ).toBeNull();
    });

    it("doesn't count deleted declarations outside a test file", () => {
      expect(reasonOf("src/router.ts", lines('-  test("/users", handler);'))).toBeNull();
    });

    it("doesn't count a deleted call that only ends in it(", () => {
      expect(reasonOf("src/a.test.ts", lines("-  submit(form);"))).toBeNull();
    });

    it.each([
      '+  it.skip("rejects a forged token", () => {',
      '+  describe.only("session", () => {',
      '+  test.todo("handles expiry");',
      '+  xit("rejects", () => {',
      '+  fdescribe("session", () => {',
      "+  @Disabled",
      "+@pytest.mark.skip(reason='flaky')",
      '+\tt.Skip("flaky")',
    ])("marks an added %s as skipping tests", (line) => {
      expect(reasonOf("src/a.test.ts", lines(line))).toBe("skips tests");
    });

    it("doesn't count an unskipped test, or a skip outside a test file", () => {
      expect(
        reasonOf("src/a.test.ts", lines('-  it.skip("x", () => {', '+  it("x", () => {')),
      ).toBeNull();
      expect(reasonOf("src/stream.ts", lines("+  reader.skip(4);", '+  xit("x");'))).toBeNull();
    });
  });

  it("lists every matching rule once, in rule order", () => {
    const body = lines("+eval(a);", "+eval(b);");
    expect(reasonOf("src/auth/package.json", body)).toBe(
      "changes dependencies (package.json); auth or security path; adds eval()",
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
      file("src/b.ts", [
        { id: h(3), body: lines("+b();") },
        { id: h(1), body: lines("+eval(b);") },
      ]),
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
      assessed(2, "contract", "m2; r2"),
      assessed(3, "logic", "m3"),
    ]);
  });

  it("leaves hunks the rules didn't assess alone", () => {
    const model = [assessed(1, "mechanical", "moved")];
    expect(raiseByRules(model, [rule(2, "contract", "r")])).toEqual(model);
  });
});

describe("credential handling in ordinary paths", () => {
  it.each([
    ["+save_secret(domain, value)", "changes credential storage (save_secret)"],
    ["-return saved_secret(domain)", "changes credential storage (saved_secret)"],
    ["+def clone_credentials(self):", "changes credential storage (clone_credentials)"],
    ["+await forgetSavedToken(host)", "changes credential storage (forgetSavedToken)"],
    ["+keyring.set_password(SERVICE, user, token)", "changes credential storage (set_password)"],
    ["-require_permission(user)", "changes authorization (require_permission)"],
    ["+return _authorization_for(token)", "changes authorization (_authorization_for)"],
    ["+if not verify_token(raw):", "changes authorization (verify_token)"],
    [
      '+@router.put("/accounts/{domain}/token")',
      "changes a credential endpoint (PUT /accounts/{domain}/token)",
    ],
    [
      "-router.delete('/accounts/:id/credentials', handler)",
      "changes a credential endpoint (DELETE /accounts/:id/credentials)",
    ],
  ])("raises %s", (text, reason) => {
    expect(reasonOf("src/service.py", lines(text))).toBe(reason);
  });

  it("names every match, once per rule", () => {
    expect(
      reasonOf(
        "src/service.py",
        lines(
          "+def save_token(self, token):",
          "+    save_secret(self.domain, token)",
          "+    save_secret(x)",
        ),
      ),
    ).toBe("changes credential storage (save_token, save_secret)");
  });

  it.each([
    "+token_count = count_words(text)",
    "+save_token_count(total)",
    "+total = count_tokens(text)",
    "+words = tokenize(text)",
    "+settings.save(path)",
    '+const [token, setToken] = useState("");',
    "+def test_saved_tokens_come_first():",
    '+await client.put("/accounts/github.com/token", { body })',
    '+router.get("/accounts/token", read)',
    '+router.put("/token-counts", update)',
    " save_secret(domain, value)",
  ])("leaves %s alone", (text) => {
    expect(reasonOf("src/service.py", lines(text))).toBeNull();
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

  it("leaves credential calls in tests and test helpers alone", () => {
    expect(
      reasonOf(
        "tests/test_picker.py",
        lines(
          "+        hosts.save_token(SavedToken('github.com', 'x'))",
          "+    clone_credentials()",
        ),
      ),
    ).toBeNull();
    expect(reasonOf("tests/fakes.py", lines("+    def save_token(self, token):"))).toBeNull();
  });

  it("counts a call only outside the file that defines it", () => {
    const hosts = file("app/hosts.py", [
      {
        id: h(1),
        body: lines("+def _saved_token(self):", "+    return saved_secret(self.domain)"),
      },
      { id: h(2), body: lines("+def with_token(self):", "+    return self._saved_token()") },
      { id: h(3), body: lines(" def accounts(self):", "+    _authorization_for(self)") },
      { id: h(4), body: lines("+def _authorization_for(self):", "+    pass") },
    ]);
    expect(classifyByRules([hosts], new Set()).map((one) => one.reason)).toEqual([
      // The definition counts, and so does a call to code this file doesn't define.
      "changes credential storage (_saved_token, saved_secret)",
      "No contract rule matched.",
      "No contract rule matched.",
      "changes authorization (_authorization_for)",
    ]);
  });

  it.each([
    ["+class SavedToken:", "changes credential storage (SavedToken)"],
    ["+export function saveSecret(value: string) {", "changes credential storage (saveSecret)"],
    ["+  async forgetSavedToken(host) {", "changes credential storage (forgetSavedToken)"],
    ["+const loadToken = async () => {", "changes credential storage (loadToken)"],
    ["+func SaveToken(t string) error {", "changes credential storage (SaveToken)"],
  ])("raises a definition: %s", (text, reason) => {
    expect(reasonOf("src/service.ts", lines(text))).toBe(reason);
  });
});

describe("ruleReasons", () => {
  const body = lines(
    "+def account_connections(self):",
    "+    return []",
    "+def save_token(self, token):",
    "+    save_secret(self.domain, token)",
  );
  const changed = file("app/services.py", [{ id: h(1), body }]);
  const whole = changed.hunks[0];
  if (whole === undefined) throw new Error("no hunk");

  it("are the reasons classifyByRules joins for a hunk", () => {
    expect(ruleReasons(whole, changed).join("; ")).toBe(
      classifyByRules([changed], new Set())[0]?.reason,
    );
  });

  it("name only the definitions a part's own lines change", () => {
    const part = (from: number, to: number): Hunk => ({
      ...whole,
      lines: whole.lines.slice(from, to),
    });
    expect(ruleReasons(part(0, 2), changed)).toEqual([]);
    expect(ruleReasons(part(2, 4), changed)).toEqual([
      "changes credential storage (save_token, save_secret)",
    ]);
  });

  it("keep a path rule's reason for every part of the file", () => {
    const manifest = file("package.json", [{ id: h(2), body: lines('+  "x": "1"') }]);
    const [only] = manifest.hunks;
    if (only === undefined) throw new Error("no hunk");
    expect(ruleReasons(only, manifest)).not.toEqual([]);
  });
});
