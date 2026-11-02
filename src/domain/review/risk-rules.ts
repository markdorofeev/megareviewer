import type { FileChange, Hunk, HunkId } from "../diff/index.ts";
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

const TEST_DIRECTORIES = new Set(["__tests__", "test", "tests", "spec"]);

/** A test file by name or directory, in the common conventions of each language. */
export const isTestFile = (path: string): boolean => {
  const name = basename(path);
  return (
    /\.(test|spec)\.[^.]+$/i.test(name) ||
    /_(test|spec)\.[^.]+$/i.test(name) ||
    /^test_.*\.py$/i.test(name) ||
    /Tests?\.(java|kt)$/.test(name) ||
    directories(path).some((directory) => TEST_DIRECTORIES.has(directory.toLowerCase()))
  );
};

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
  "credential",
  "credentials",
  "security",
  "csrf",
  "cors",
  "login",
  "saml",
  "sso",
]);

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
  (path) =>
    pathWords(path).some((word) => SECURITY_WORDS.has(word)) ? "auth or security path" : null,
];

const DANGEROUS_CALLS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /(?<![\w$])eval\s*\(/, label: "eval()" },
  { pattern: /\bnew\s+Function\s*\(/, label: "new Function()" },
  { pattern: /\binnerHTML\b/, label: "innerHTML" },
  { pattern: /\bouterHTML\b/, label: "outerHTML" },
  { pattern: /\binsertAdjacentHTML\b/, label: "insertAdjacentHTML" },
  { pattern: /\bdocument\.write(ln)?\s*\(/, label: "document.write()" },
  { pattern: /\bdangerouslySetInnerHTML\b/, label: "dangerouslySetInnerHTML" },
  { pattern: /\bchild_process\b/, label: "child_process" },
  { pattern: /\brejectUnauthorized\s*:\s*false\b/, label: "rejectUnauthorized: false" },
  { pattern: /\bNODE_TLS_REJECT_UNAUTHORIZED\b/, label: "NODE_TLS_REJECT_UNAUTHORIZED" },
  { pattern: /\bverify\s*=\s*False\b/, label: "verify=False" },
  { pattern: /\bInsecureSkipVerify\s*:\s*true\b/, label: "InsecureSkipVerify" },
  { pattern: /(^|\s)--no-verify\b/, label: "--no-verify" },
];

const TEST_DECLARATIONS: readonly RegExp[] = [
  /(?<![\w$.])(it|test|describe)(\.\w+)*\s*\(/,
  /\bdef\s+test_/,
  /\bfunc\s+Test\w*\s*\(/,
  /@Test\b/,
];

const TEST_SKIPS: readonly RegExp[] = [
  /(?<![\w$.])(it|test|describe)\.(skip|only|todo)\s*\(/,
  /(?<![\w$.])[xf](it|test|describe)\s*\(/,
  /@(Disabled|Ignore)\b/,
  /@pytest\.mark\.skip/,
  /\bt\.Skip(Now|f)?\s*\(/,
];

const textOf = (hunk: Hunk, kind: "add" | "del"): string[] =>
  hunk.lines.flatMap((line) => (line.kind === kind ? [line.text] : []));

const count = (lines: readonly string[], patterns: readonly RegExp[]): number =>
  lines.filter((line) => patterns.some((pattern) => pattern.test(line))).length;

/** A rule on one hunk of a file: the reason when it matches, else null. */
type HunkRule = (hunk: Hunk, file: FileChange) => string | null;

const HUNK_RULES: readonly HunkRule[] = [
  (hunk) => {
    const added = textOf(hunk, "add");
    const labels = DANGEROUS_CALLS.filter(({ pattern }) =>
      added.some((line) => pattern.test(line)),
    ).map(({ label }) => label);
    return labels.length === 0 ? null : `adds ${labels.join(", ")}`;
  },
  (hunk, file) => {
    if (!isTestFile(file.path)) return null;
    if (file.status === "deleted") return "removes tests";
    // An edited test deletes and adds its declaration line; only a net loss removes a test.
    const removed =
      count(textOf(hunk, "del"), TEST_DECLARATIONS) - count(textOf(hunk, "add"), TEST_DECLARATIONS);
    return removed > 0 ? "removes tests" : null;
  },
  (hunk, file) =>
    isTestFile(file.path) && count(textOf(hunk, "add"), TEST_SKIPS) > 0 ? "skips tests" : null,
];

/**
 * The model's risk raised by the rules: a hunk is contract if either says so. A rule's contract
 * over the model's logic keeps the rule's assessment; when both say contract, the reasons join.
 */
export const raiseByRules = (
  assessments: readonly RiskAssessment[],
  rules: readonly RiskAssessment[],
): RiskAssessment[] => {
  const byHunk = new Map(rules.map((rule) => [rule.hunkId, rule]));
  return assessments.map((assessment) => {
    const rule = byHunk.get(assessment.hunkId);
    if (rule === undefined || rule.riskClass !== "contract") return assessment;
    return assessment.riskClass === "contract"
      ? { ...assessment, reason: `${assessment.reason}; ${rule.reason}` }
      : rule;
  });
};

/**
 * Risk for every hunk without a mechanical proof, from deterministic rules. A hunk any rule
 * matches is contract, with every matching rule's reason; the rest are logic. Rules only raise
 * attention: they never make a hunk mechanical, and they skip hunks a proof already covers. A
 * renamed file is matched by its old path too, so moving code out of a sensitive place counts.
 */
export const classifyByRules = (
  files: readonly FileChange[],
  mechanicalHunkIds: ReadonlySet<HunkId>,
): RiskAssessment[] =>
  files.flatMap((file) => {
    const paths = file.oldPath === null ? [file.path] : [file.path, file.oldPath];
    const pathReasons = PATH_RULES.flatMap(
      (rule) => paths.map(rule).find((reason): reason is string => reason !== null) ?? [],
    );
    return file.hunks
      .filter((hunk) => !mechanicalHunkIds.has(hunk.id))
      .map((hunk): RiskAssessment => {
        const reasons = [...pathReasons, ...HUNK_RULES.flatMap((rule) => rule(hunk, file) ?? [])];
        return reasons.length === 0
          ? { hunkId: hunk.id, riskClass: "logic", reason: NO_RULE, source: "rule" }
          : {
              hunkId: hunk.id,
              riskClass: "contract",
              reason: [...new Set(reasons)].join("; "),
              source: "rule",
            };
      });
  });
