import { describe, expect, it } from "vitest";
import {
  type CheckConfig,
  checkConfigPathsFor,
  checkConfigsOf,
  type GuardrailDraft,
  GuardrailRule,
  guardrailOf,
  MAX_CHECK_CONFIG_BYTES,
  ruleStanding,
} from "./index.ts";

const biome: CheckConfig = {
  tool: "biome",
  path: "biome.json",
  content:
    '{ "linter": { "rules": { "recommended": true, "style": { "noNonNullAssertion": "off" } } } }',
};
const ruff: CheckConfig = {
  tool: "ruff",
  path: "pyproject.toml",
  content: '[tool.ruff.lint]\nselect = ["E", "F"]\n',
};

describe("checkConfigPathsFor", () => {
  it("looks for the configs of the tools that check the changed files, in table order", () => {
    expect(checkConfigPathsFor(["src/app.ts", "README.md"])).toEqual([
      "biome.json",
      "biome.jsonc",
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.ts",
      ".eslintrc.json",
      ".eslintrc.js",
      "tsconfig.json",
    ]);
    expect(checkConfigPathsFor(["web/page.JSX"])).not.toContain("tsconfig.json");
    expect(checkConfigPathsFor(["tools/build.py", "cmd/main.go", "app/models/user.rb"])).toEqual([
      "ruff.toml",
      ".ruff.toml",
      "pyproject.toml",
      ".golangci.yml",
      ".golangci.yaml",
      ".rubocop.yml",
    ]);
    expect(checkConfigPathsFor(["src/main/java/acme/OrderService.java"])).toEqual([
      "checkstyle.xml",
      "config/checkstyle/checkstyle.xml",
      "pmd.xml",
      "ruleset.xml",
      "config/pmd/ruleset.xml",
    ]);
  });

  it("looks for nothing for files no tool checks", () => {
    expect(checkConfigPathsFor(["docs/guide.md", "Makefile", ".env"])).toEqual([]);
  });
});

describe("checkConfigsOf", () => {
  it("finds the configs that are there, each under its tool", () => {
    const found = checkConfigsOf(
      new Map([
        ["biome.json", biome.content],
        ["tsconfig.json", '{ "compilerOptions": { "strict": true } }'],
        ["eslint.config.js", null],
      ]),
    );
    expect(found.configs.map(({ tool, path }) => [tool, path])).toEqual([
      ["biome", "biome.json"],
      ["typescript", "tsconfig.json"],
    ]);
    expect(found.tooLarge).toEqual([]);
  });

  it("reads a pyproject.toml as Ruff's config only when it has a [tool.ruff table", () => {
    const without = checkConfigsOf(new Map([["pyproject.toml", '[project]\nname = "shop"\n']]));
    expect(without.configs).toEqual([]);
    const withRuff = checkConfigsOf(new Map([["pyproject.toml", ruff.content]]));
    expect(withRuff.configs).toEqual([ruff]);
  });

  it("leaves out a config over the limit and names it", () => {
    const large = `{ "x": "${"a".repeat(MAX_CHECK_CONFIG_BYTES)}" }`;
    const found = checkConfigsOf(new Map([["biome.json", large]]));
    expect(found.configs).toEqual([]);
    expect(found.tooLarge).toEqual([
      { tool: "biome", path: "biome.json", bytes: MAX_CHECK_CONFIG_BYTES + 11 },
    ]);
  });
});

describe("ruleStanding", () => {
  it("says a rule the tool's config doesn't name is unnamed, with the tool's first config", () => {
    expect(ruleStanding("biome", "noFloatingPromises", [biome])).toEqual({
      is: "unnamed",
      configPath: "biome.json",
    });
  });

  it("says a rule a config names is named, whatever its case, with the config that names it", () => {
    const local: CheckConfig = {
      tool: "biome",
      path: "biome.jsonc",
      content: '{ "noVar": "error" }',
    };
    expect(ruleStanding("biome", "novar", [biome, local])).toEqual({
      is: "named",
      configPath: "biome.jsonc",
    });
    expect(ruleStanding("biome", "NONONNULLASSERTION", [biome])).toMatchObject({ is: "named" });
  });

  it("reads a Ruff selector that prefixes the rule's code, or ALL, as naming it", () => {
    expect(ruleStanding("ruff", "E711", [ruff])).toMatchObject({ is: "named" });
    expect(ruleStanding("ruff", "B006", [ruff])).toMatchObject({ is: "unnamed" });
    const all = { ...ruff, content: '[tool.ruff.lint]\nselect = ["ALL"]\n' };
    expect(ruleStanding("ruff", "B006", [all])).toMatchObject({ is: "named" });
  });

  it("reads a Ruff selector by its linter's letters, so B doesn't select BLE001", () => {
    const some = { ...ruff, content: '[tool.ruff.lint]\nselect = ["E", "B", "S1", "PL"]\n' };
    const standing = (rule: string) => ruleStanding("ruff", rule, [some]).is;
    expect(standing("B006")).toBe("named");
    expect(standing("BLE001")).toBe("unnamed");
    expect(standing("ERA001")).toBe("unnamed");
    expect(standing("S101")).toBe("named");
    expect(standing("S608")).toBe("unnamed");
    expect(standing("SIM102")).toBe("unnamed");
    expect(standing("PLR2004")).toBe("named");
  });

  it("knows nothing of a rule whose tool has no config, or that isn't a name", () => {
    expect(GuardrailRule.safeParse("add noFloatingPromises").success).toBe(false);
    expect(GuardrailRule.safeParse("@typescript-eslint/no-floating-promises").success).toBe(true);
    expect(ruleStanding("eslint", "no-var", [biome])).toEqual({ is: "unknown" });
    expect(ruleStanding("biome", "turn it on", [biome])).toEqual({ is: "unknown" });
  });
});

describe("guardrailOf", () => {
  const draft = (overrides: Partial<GuardrailDraft>): GuardrailDraft => ({
    kind: "lint-rule",
    tool: "biome",
    engine: "Biome",
    rule: "noFloatingPromises",
    on: false,
    does: "Reports a promise that is neither awaited nor returned.",
    ...overrides,
  });

  it("verifies a rule the config doesn't name and the model says is off", () => {
    expect(guardrailOf(draft({}), [biome], [])).toEqual({
      is: "rule",
      tool: "biome",
      rule: "noFloatingPromises",
      configPath: "biome.json",
    });
  });

  it("says nothing of a rule its config names, on or off, whatever the model says", () => {
    expect(guardrailOf(draft({ rule: "noNonNullAssertion" }), [biome], [])).toBeNull();
  });

  it("says nothing of a rule the model says a preset turns on", () => {
    expect(guardrailOf(draft({ on: true }), [biome], [])).toBeNull();
  });

  it("suggests a rule of a tool whose config the pull request changes, which verifies nothing", () => {
    expect(guardrailOf(draft({}), [biome], ["src/app.ts", "biome.json"])).toEqual({
      is: "suggested",
      kind: "lint-rule",
      engine: "Biome",
      does: "Reports a promise that is neither awaited nor returned.",
    });
    expect(
      guardrailOf(draft({ rule: "noNonNullAssertion" }), [biome], ["biome.json"]),
    ).toMatchObject({ is: "suggested" });
  });

  it("suggests a named rule of a tool without a config, as the model's word", () => {
    expect(
      guardrailOf(
        draft({ tool: "eslint", engine: "ESLint", rule: "no-floating-promises" }),
        [biome],
        [],
      ),
    ).toEqual({
      is: "suggested",
      kind: "lint-rule",
      engine: "ESLint",
      does: "Reports a promise that is neither awaited nor returned.",
    });
  });

  it("suggests a check by any engine, its sentence on one line", () => {
    expect(
      guardrailOf(
        draft({
          kind: "architecture-rule",
          tool: null,
          engine: "ArchUnit",
          rule: null,
          does: "  Services never import\n a controller. ",
        }),
        [],
        [],
      ),
    ).toEqual({
      is: "suggested",
      kind: "architecture-rule",
      engine: "ArchUnit",
      does: "Services never import a controller.",
    });
  });

  it("says nothing of a check the model says is on but megareviewer can't read", () => {
    expect(guardrailOf(draft({ tool: null, rule: null, on: true }), [biome], [])).toBeNull();
    expect(guardrailOf(draft({ tool: "eslint", on: true }), [biome], [])).toBeNull();
  });

  it("says nothing of a draft without a valid kind, engine or sentence", () => {
    const loose = { tool: null, rule: null };
    expect(guardrailOf(draft({ ...loose, kind: "vibe-check" }), [], [])).toBeNull();
    expect(guardrailOf(draft({ ...loose, engine: "run `rm -rf`; then" }), [], [])).toBeNull();
    expect(guardrailOf(draft({ ...loose, engine: "" }), [], [])).toBeNull();
    expect(guardrailOf(draft({ ...loose, does: " " }), [], [])).toBeNull();
    expect(guardrailOf(draft({ ...loose, does: "a".repeat(161) }), [], [])).toBeNull();
  });

  it("falls to a suggestion when the rule isn't a name", () => {
    expect(guardrailOf(draft({ rule: "turn it on, please" }), [biome], [])).toMatchObject({
      is: "suggested",
      engine: "Biome",
    });
  });
});
