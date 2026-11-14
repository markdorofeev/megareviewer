import { type FileChange, type Hunk, type HunkId, isTestFile } from "../diff/index.ts";

export { isTestFile };

import type { RiskAssessment } from "./risk.ts";

const NO_RULE = "No contract rule matched.";

// Repository paths are always "/"-separated.
const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const directories = (path: string): string[] => path.split("/").slice(0, -1);
const extension = (path: string): string => {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
};

/** "src/auth/verifySession.ts" → src, auth, verify, session, ts. */
const pathWords = (path: string): string[] =>
  (path.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? []).map((word) => word.toLowerCase());

const MANIFESTS = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "Pipfile",
  "Gemfile",
  "composer.json",
  "Podfile",
  "pubspec.yaml",
  "mix.exs",
  "flake.nix",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
]);
const SCHEMA_EXTENSIONS = new Set([".sql", ".prisma", ".proto", ".graphql", ".gql", ".avsc"]);
const SCHEMA_DIRECTORIES = new Set(["migrations", "migrate"]);
const CI_BASENAMES = new Set([".gitlab-ci.yml", "bitbucket-pipelines.yml", "Jenkinsfile"]);
const INFRASTRUCTURE_EXTENSIONS = new Set([".tf", ".tfvars"]);
const CONFIG_BASENAMES = new Set([".npmrc", "CODEOWNERS", ".gitattributes"]);
const APP_CONFIG_EXTENSIONS = new Set([
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".ini",
  ".properties",
  ".conf",
  ".cfg",
]);
const APP_CONFIG_DIRECTORIES = new Set(["config", "configs", "conf", "settings"]);
const SECURITY_WORDS = new Set([
  "admin",
  "auth",
  "authn",
  "authz",
  "authentication",
  "authorization",
  "oauth",
  "session",
  "sessions",
  "token",
  "tokens",
  "jwt",
  "permission",
  "permissions",
  "acl",
  "rbac",
  "crypto",
  "secret",
  "secrets",
  "password",
  "passwords",
  "keychain",
  "keyring",
  "credential",
  "credentials",
  "security",
  "csrf",
  "cors",
  "login",
  "saml",
  "sso",
]);

/** A file a test imports to stand in for real code: fakes.py, mock-session.ts, stub_hosts.py. */
const TEST_HELPER = /(^|[._-])(fakes?|mocks?|stubs?|fixtures?)([._-]|$)/i;

/**
 * Test code: tests, and helpers named for what they fake. A test that saves a token or a fake on
 * a keychain path checks or stands in for credential code; it isn't credential code itself, so the
 * credential and security-path rules leave it alone. Removed and skipped tests still count.
 */
const isTestCode = (path: string): boolean => isTestFile(path) || TEST_HELPER.test(basename(path));

const SECURITY_PATH = "auth or security path";

/** A rule on one path: the reason when it matches, else null. */
type PathRule = (path: string) => string | null;

const PATH_RULES: readonly PathRule[] = [
  (path) => {
    const name = basename(path);
    const manifest =
      MANIFESTS.has(name) || /^requirements.*\.txt$/.test(name) || extension(path) === ".csproj";
    return manifest ? `changes dependencies (${name})` : null;
  },
  (path) =>
    SCHEMA_EXTENSIONS.has(extension(path)) ||
    directories(path).some((directory) => SCHEMA_DIRECTORIES.has(directory.toLowerCase())) ||
    /^(openapi|swagger)/i.test(basename(path))
      ? "changes a schema or migration"
      : null,
  (path) => {
    const name = basename(path);
    const lower = name.toLowerCase();
    return path.startsWith(".github/workflows/") ||
      path.startsWith(".circleci/") ||
      CI_BASENAMES.has(name) ||
      lower.startsWith("dockerfile") ||
      lower.endsWith(".dockerfile") ||
      lower.startsWith("docker-compose") ||
      /^compose\.ya?ml$/.test(lower) ||
      INFRASTRUCTURE_EXTENSIONS.has(extension(path))
      ? "changes CI or infrastructure"
      : null;
  },
  (path) => {
    const name = basename(path);
    return CONFIG_BASENAMES.has(name) ||
      name.startsWith(".env") ||
      name.startsWith(".yarnrc") ||
      /^tsconfig.*\.json$/.test(name)
      ? `changes repository config (${name})`
      : null;
  },
  (path) => {
    const name = basename(path);
    const inConfig = directories(path).some((directory) =>
      APP_CONFIG_DIRECTORIES.has(directory.toLowerCase()),
    );
    return APP_CONFIG_EXTENSIONS.has(extension(path)) &&
      (inConfig || /^(config|settings|application)\./i.test(name))
      ? `changes app config (${name})`
      : null;
  },
  (path) =>
    !isTestCode(path) && pathWords(path).some((word) => SECURITY_WORDS.has(word))
      ? SECURITY_PATH
      : null,
];

/** Languages whose lines can be plain text or markup, as a page's copy is. */
const MARKUP = new Set([".tsx", ".jsx", ".vue", ".svelte", ".html", ".astro"]);

/**
 * Lines that do nothing: blank, a comment, an import, a string on its own, an UPPER_CASE constant
 * set to a literal, a closing bracket, and in markup, a tag with only literal attributes or plain
 * text. Anything else might, so it isn't inert: a check, a return, a call, an expression in braces.
 */
const INERT: readonly RegExp[] = [
  /^\s*$/,
  /^\s*(?:#|\/\/|\/\*|\*|<!--)/,
  /^\s*[rbfu]?(["'`]).*\1\s*,?\s*$/i,
  /^\s*(?:export\s+)?(?:const\s+)?[A-Z][A-Z0-9_]*\s*(?::\s*\w+\s*)?=\s*(?:["'`(]|-?\d|True\b|False\b|None\b|true\b|false\b|null\b)[^()]*$/,
  /^\s*[)\]}]+[,;]?\s*$/,
];
const INERT_MARKUP: readonly RegExp[] = [
  /^\s*<\/?[A-Za-z][\w.]*(?:\s+[\w:-]+(?:="[^"]*")?)*\s*\/?>\s*$/,
  // Text, unless it starts like a statement: `return`, `throw`, `else` are code without brackets.
  /^(?!\s*(?:return|throw|await|yield|break|continue|else|case|default|export|const|let|var|async|function|import)\b)\s*[^<>{}()=;]*(?:\{" "\})?\s*$/,
];

/**
 * Every changed line of a hunk is inert, so a security path alone doesn't make it contract: the
 * keychain module's constants, or a credentials guide's copy, change no behavior. Other rules
 * still apply to it.
 */
const inertOnly = (hunk: Hunk, file: FileChange): boolean => {
  const patterns = MARKUP.has(extension(file.path)) ? [...INERT, ...INERT_MARKUP] : INERT;
  return [...textOf(hunk, "add"), ...textOf(hunk, "del")].every(
    (line) => IMPORT.test(line) || patterns.some((pattern) => pattern.test(line)),
  );
};

/** An import names a module; it runs nothing. */
const IMPORT =
  /^\s*(?:import\b|from\s+[\w.]+\s+import\b|export\s.*\bfrom\s|(?:const|let|var)\s.*=\s*require\s*\()/;

const textOf = (hunk: Hunk, kind: "add" | "del"): string[] =>
  hunk.lines.flatMap((line) => (line.kind === kind ? [line.text] : []));

/**
 * The model's risk raised by the rules: a hunk is contract if either says so. A rule's contract
 * over the model's logic keeps the rule's assessment; when both say contract, the model's stands,
 * since its reason is about the code and the page shows it.
 */
export const raiseByRules = (
  assessments: readonly RiskAssessment[],
  rules: readonly RiskAssessment[],
): RiskAssessment[] => {
  const byHunk = new Map(rules.map((rule) => [rule.hunkId, rule]));
  return assessments.map((assessment) => {
    const rule = byHunk.get(assessment.hunkId);
    return rule?.riskClass === "contract" && assessment.riskClass !== "contract"
      ? rule
      : assessment;
  });
};

/** The reasons the path rules give for a file: they hold for every hunk in it. */
export const pathReasons = (file: FileChange): string[] => {
  const paths = file.oldPath === null ? [file.path] : [file.path, file.oldPath];
  return PATH_RULES.flatMap(
    (rule) => paths.map(rule).find((reason): reason is string => reason !== null) ?? [],
  );
};

/**
 * The contract rules' reasons for a hunk, or for a part of one: its file's path rules, except a
 * security path when every line it changes is inert. The rules read what a file is, never the
 * shape of the names in it: a name doesn't say what a check guards or what a response exposes.
 */
export const ruleReasons = (hunk: Hunk, file: FileChange): string[] => {
  const inert = inertOnly(hunk, file);
  return pathReasons(file).filter((reason) => reason !== SECURITY_PATH || !inert);
};

/**
 * Rules only raise a hunk to contract, never to mechanical. A renamed file is matched by its old
 * path too, so moving code out of a sensitive place counts.
 */
export const classifyByRules = (
  files: readonly FileChange[],
  mechanicalHunkIds: ReadonlySet<HunkId>,
): RiskAssessment[] =>
  files.flatMap((file) =>
    file.hunks
      .filter((hunk) => !mechanicalHunkIds.has(hunk.id))
      .map((hunk): RiskAssessment => {
        const reasons = ruleReasons(hunk, file);
        return reasons.length === 0
          ? { hunkId: hunk.id, riskClass: "logic", reason: NO_RULE, source: "rule", lines: null }
          : {
              hunkId: hunk.id,
              riskClass: "contract",
              reason: reasons.join("; "),
              source: "rule",
              lines: null,
            };
      }),
  );
