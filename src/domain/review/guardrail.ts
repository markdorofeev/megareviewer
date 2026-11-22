import { z } from "zod";

/** The linters and type checkers whose configs megareviewer reads, to verify a rule. */
export const GuardrailTool = z.enum([
  "biome",
  "eslint",
  "typescript",
  "ruff",
  "golangci-lint",
  "rubocop",
  "checkstyle",
  "pmd",
]);
export type GuardrailTool = z.infer<typeof GuardrailTool>;

/** A rule's name as its tool writes it, and nothing else: it can't carry a sentence. */
export const GuardrailRule = z.string().regex(/^[A-Za-z0-9@/_.:-]{1,80}$/);
export type GuardrailRule = z.infer<typeof GuardrailRule>;

/** The kind of check a suggested guardrail is. */
export const GuardrailKind = z.enum([
  "lint-rule",
  "type-option",
  "formatter",
  "pattern-rule",
  "architecture-rule",
  "ci-check",
]);
export type GuardrailKind = z.infer<typeof GuardrailKind>;

/** What runs a suggested check, by name: "ArchUnit", "Semgrep", "Error Prone". */
export const GuardrailEngine = z.string().regex(/^[A-Za-z0-9 .+#_-]{1,40}$/);
export type GuardrailEngine = z.infer<typeof GuardrailEngine>;

export const MAX_GUARDRAIL_DOES = 160;

/** What a suggested check would assert, one sentence. */
export const GuardrailDoes = z
  .string()
  .transform((text) => text.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(MAX_GUARDRAIL_DOES));

/**
 * A check that would catch a kind of problem before review, in any code. rule: a named rule of a
 * tool whose config megareviewer read, which the config doesn't name. suggested: a kind of check on
 * an engine, the model's word alone.
 */
export const Guardrail = z
  .discriminatedUnion("is", [
    z.object({
      is: z.literal("rule"),
      tool: GuardrailTool,
      rule: GuardrailRule,
      configPath: z.string().min(1),
    }),
    z.object({
      is: z.literal("suggested"),
      kind: GuardrailKind,
      engine: GuardrailEngine,
      does: GuardrailDoes,
    }),
  ])
  .readonly();
export type Guardrail = z.infer<typeof Guardrail>;

/**
 * A point's guardrail as an analysis keeps it. One stored by an earlier version of this stage,
 * which only its branch made, reads as none, never as an analysis that doesn't parse. Absent
 * when the call didn't mark it.
 */
export const StoredGuardrail = Guardrail.optional().catch(undefined);

const SCRIPTS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"] as const;

/** Each tool's config paths in a repository, and the extensions of the files it checks. */
export const CHECK_CONFIG_PATHS: Readonly<
  Record<GuardrailTool, { readonly paths: readonly string[]; readonly for: readonly string[] }>
> = {
  biome: { paths: ["biome.json", "biome.jsonc"], for: SCRIPTS },
  eslint: {
    paths: [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.ts",
      ".eslintrc.json",
      ".eslintrc.js",
    ],
    for: SCRIPTS,
  },
  typescript: { paths: ["tsconfig.json"], for: [".ts", ".tsx", ".mts", ".cts"] },
  ruff: { paths: ["ruff.toml", ".ruff.toml", "pyproject.toml"], for: [".py"] },
  "golangci-lint": { paths: [".golangci.yml", ".golangci.yaml"], for: [".go"] },
  rubocop: { paths: [".rubocop.yml"], for: [".rb"] },
  checkstyle: { paths: ["checkstyle.xml", "config/checkstyle/checkstyle.xml"], for: [".java"] },
  pmd: { paths: ["pmd.xml", "ruleset.xml", "config/pmd/ruleset.xml"], for: [".java"] },
};

/** Build files, read for the model only, so it prefers an engine the repository already uses. */
export const BUILD_FILE_PATHS = ["package.json", "pom.xml", "build.gradle", "build.gradle.kts"];

/** As a guideline file: a larger one isn't sent, since cutting it could drop the rule that's on. A build file too. */
export const MAX_CHECK_CONFIG_BYTES = 32_768;

/** A tool's config at the repository's root, as it was at the PR's base commit. */
export interface CheckConfig {
  readonly tool: GuardrailTool;
  readonly path: string;
  readonly content: string;
}

/** A check config or build file a model run read, without its content, as the analysis keeps it. */
export const ReadCheckConfig = z
  .object({
    /** null for a build file. */
    tool: GuardrailTool.nullable(),
    path: z.string(),
    bytes: z.number().int().nonnegative(),
  })
  .readonly();
export type ReadCheckConfig = z.infer<typeof ReadCheckConfig>;

const TOOLS = GuardrailTool.options;

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
};

/** The config paths to look for, for the tools that check files of these paths. */
export const checkConfigPathsFor = (paths: readonly string[]): string[] => {
  const extensions = new Set(paths.map(extensionOf));
  return TOOLS.flatMap((tool) =>
    CHECK_CONFIG_PATHS[tool].for.some((extension) => extensions.has(extension))
      ? CHECK_CONFIG_PATHS[tool].paths
      : [],
  );
};

const utf8 = new TextEncoder();

export interface FoundCheckConfigs {
  /** In the order of CHECK_CONFIG_PATHS. */
  readonly configs: readonly CheckConfig[];
  /** Over MAX_CHECK_CONFIG_BYTES, so left out. */
  readonly tooLarge: readonly ReadCheckConfig[];
}

/**
 * The check configs a repository has, from each path's content or null where there's no file. A
 * `pyproject.toml` configures Ruff only with a `[tool.ruff` table.
 */
export const checkConfigsOf = (contents: ReadonlyMap<string, string | null>): FoundCheckConfigs => {
  const configs: CheckConfig[] = [];
  const tooLarge: ReadCheckConfig[] = [];
  for (const tool of TOOLS) {
    for (const path of CHECK_CONFIG_PATHS[tool].paths) {
      const content = contents.get(path) ?? null;
      if (content === null) continue;
      if (path === "pyproject.toml" && !/^\s*\[tool\.ruff\b/m.test(content)) continue;
      const bytes = utf8.encode(content).byteLength;
      if (bytes > MAX_CHECK_CONFIG_BYTES) tooLarge.push({ tool, path, bytes });
      else configs.push({ tool, path, content });
    }
  }
  return { configs, tooLarge };
};

const RUFF_CODE = /^([A-Za-z]+)([0-9]*)$/;

/**
 * Ruff's selectors go by linter: a rule's letters name its linter and its digits the rule, so "B"
 * and "B0" select B006 and never BLE001, another linter's. Pylint's "PL" covers PLC, PLE, PLR, PLW.
 */
const ruffSelects = (rule: string, content: string): boolean => {
  const code = RUFF_CODE.exec(rule.toUpperCase());
  if (code === null) return false;
  const [, linter = "", number = ""] = code;
  return [...content.matchAll(/["']([A-Za-z]+[0-9]*)["']/g)].some(([, quoted = ""]) => {
    const [, letters = "", digits = ""] = RUFF_CODE.exec(quoted.toUpperCase()) ?? [];
    if (letters === "ALL") return true;
    if (letters === "PL" && digits === "") return linter.startsWith("PL");
    return letters === linter && number.startsWith(digits);
  });
};

/** Where a rule stands in the repository's configs, as far as their text says. */
export type RuleStanding =
  /** The tool's config doesn't name the rule; `configPath` is the tool's first config. */
  | { readonly is: "unnamed"; readonly configPath: string }
  /** A config of the tool names the rule, whatever its case: it's on, or was turned off on purpose. */
  | { readonly is: "named"; readonly configPath: string }
  /** The repository has no config for the tool, or the rule isn't a rule's name. */
  | { readonly is: "unknown" };

const names = ({ tool, content }: CheckConfig, rule: string): boolean =>
  content.toLowerCase().includes(rule.toLowerCase()) ||
  (tool === "ruff" && ruffSelects(rule, content));

/** A tool's rule against the repository's configs. */
export const ruleStanding = (
  tool: GuardrailTool,
  rule: string,
  configs: readonly CheckConfig[],
): RuleStanding => {
  if (!GuardrailRule.safeParse(rule).success) return { is: "unknown" };
  const own = configs.filter((config) => config.tool === tool);
  const [first] = own;
  if (first === undefined) return { is: "unknown" };
  const naming = own.find((config) => names(config, rule));
  return naming === undefined
    ? { is: "unnamed", configPath: first.path }
    : { is: "named", configPath: naming.path };
};

/** A guardrail as the model drafts it, before the server checks it. */
export interface GuardrailDraft {
  readonly kind: string;
  readonly tool: GuardrailTool | null;
  readonly engine: string;
  readonly rule: string | null;
  /** Whether the model says the repository already has it on. */
  readonly on: boolean;
  readonly does: string;
}

const suggestedOf = (draft: GuardrailDraft): Guardrail | null => {
  const parsed = Guardrail.safeParse({
    is: "suggested",
    kind: draft.kind,
    engine: draft.engine.trim(),
    does: draft.does,
  });
  return parsed.success ? parsed.data : null;
};

/**
 * The model's draft as a guardrail, or null. A named rule of a tool whose config the repository has
 * at the base commit, and the pull request doesn't change, is verified against it: a rule the
 * config doesn't name and the model says is off; a rule the repository already has is none, since
 * there's nothing to move to a check. Anything else is the model's word, a suggested check, unless
 * the model says the repository already has it, which megareviewer can't check and so doesn't say.
 */
export const guardrailOf = (
  draft: GuardrailDraft,
  configs: readonly CheckConfig[],
  changedPaths: readonly string[],
): Guardrail | null => {
  if (draft.tool !== null && draft.rule !== null) {
    const { tool } = draft;
    const rule = draft.rule.trim();
    // A config the pull request changes no longer says what the repository will have.
    const unchanged = configs.filter((config) => !changedPaths.includes(config.path));
    const changed = configs.some(
      (config) => config.tool === tool && changedPaths.includes(config.path),
    );
    const standing = changed ? { is: "unknown" as const } : ruleStanding(tool, rule, unchanged);
    if (standing.is === "named") return null;
    if (standing.is === "unnamed") {
      return draft.on ? null : { is: "rule", tool, rule, configPath: standing.configPath };
    }
  }
  return draft.on ? null : suggestedOf(draft);
};

/** How the page names a tool. */
export const GUARDRAIL_TOOL_NAMES: Readonly<Record<GuardrailTool, string>> = {
  biome: "Biome",
  eslint: "ESLint",
  typescript: "TypeScript",
  ruff: "Ruff",
  "golangci-lint": "golangci-lint",
  rubocop: "RuboCop",
  checkstyle: "Checkstyle",
  pmd: "PMD",
};

/** How the page names a suggested check's kind, after "a" or "an". */
export const GUARDRAIL_KIND_NAMES: Readonly<Record<GuardrailKind, string>> = {
  "lint-rule": "lint rule",
  "type-option": "type-checker option",
  formatter: "formatter setting",
  "pattern-rule": "pattern rule",
  "architecture-rule": "architecture rule",
  "ci-check": "CI check",
};
