import { type FileChange, type Hunk, type HunkId, isTestFile, routesOn } from "../diff/index.ts";

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

/** An import names a module; it runs nothing, so a risky module imported isn't a risky call. */
const IMPORT =
  /^\s*(?:import\b|from\s+[\w.]+\s+import\b|export\s.*\bfrom\s|(?:const|let|var)\s.*=\s*require\s*\()/;

const DANGEROUS_CALLS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /(?<![\w$])eval\s*\(/, label: "eval()" },
  { pattern: /\bnew\s+Function\s*\(/, label: "new Function()" },
  { pattern: /\binnerHTML\b/, label: "innerHTML" },
  { pattern: /\bouterHTML\b/, label: "outerHTML" },
  { pattern: /\binsertAdjacentHTML\b/, label: "insertAdjacentHTML" },
  { pattern: /\bdocument\.write(ln)?\s*\(/, label: "document.write()" },
  { pattern: /\bdangerouslySetInnerHTML\b/, label: "dangerouslySetInnerHTML" },
  { pattern: /\bchild_process\b/, label: "child_process" },
  { pattern: /\bsubprocess\b/, label: "subprocess" },
  { pattern: /\bos\.system\s*\(/, label: "os.system()" },
  { pattern: /\bos\.popen\s*\(/, label: "os.popen()" },
  { pattern: /\bshell\s*=\s*True\b/, label: "shell=True" },
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

const CREDENTIAL_NOUNS = new Set([
  "secret",
  "secrets",
  "token",
  "tokens",
  "credential",
  "credentials",
  "password",
  "passwords",
  "passphrase",
]);
/** What a function does with a credential to store or fetch it: save_secret, forgetSavedToken. */
const STORAGE_VERBS = new Set([
  "save",
  "saved",
  "store",
  "stored",
  "persist",
  "set",
  "get",
  "load",
  "read",
  "write",
  "find",
  "delete",
  "remove",
  "forget",
  "clear",
  "clone",
  "rotate",
  "revoke",
  "refresh",
]);
const AUTHORIZATION_WORDS = new Set([
  "authorize",
  "authorized",
  "authorization",
  "authenticate",
  "authentication",
  "permission",
  "permissions",
]);
const CHECK_VERBS = new Set(["verify", "validate", "check"]);

const CHANGING_METHODS = new Set(["PUT", "POST", "PATCH", "DELETE", "ALL"]);
const CREDENTIAL_SEGMENT = /^(?:tokens?|credentials?|passwords?|secrets?|api[-_]?keys?)$/i;

/**
 * Names called or defined on a line: `save_secret(`, `def clone_credentials(`. A test's name
 * describes it, and a React state setter like `setToken` holds what a form shows, not a stored
 * credential, so neither counts.
 */
const calledNames = (line: string): string[] =>
  [...line.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].flatMap(([, name]) =>
    name === undefined || /^(?:test(?:_|[A-Z])|set[A-Z])/.test(name) ? [] : [name],
  );

/**
 * Names a line defines: `def save_token(`, `class SavedToken`, `function saveSecret(`,
 * `const loadToken = async () =>`, `func SaveToken(`, and a method like `async forgetToken(host) {`.
 */
const DEFINITIONS: readonly RegExp[] = [
  /\b(?:def|class|function|func|fn|interface|type|struct)\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/g,
  /^\s*(?:(?:public|private|protected|static|async|override)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^={]*)?\{\s*$/g,
];

const definedNames = (line: string): string[] =>
  DEFINITIONS.flatMap((pattern) =>
    [...line.matchAll(pattern)].flatMap(([, name]) => (name === undefined ? [] : [name])),
  ).filter((name) => !/^(?:if|for|while|switch|catch|return)$/.test(name));

/** Every name the file's hunks define, on any line: what a call in the file may be calling. */
const definedInFile = (file: FileChange): ReadonlySet<string> =>
  new Set(file.hunks.flatMap((hunk) => hunk.lines.flatMap((line) => definedNames(line.text))));

/**
 * The credential names a changed line defines, or calls when the file doesn't define them. A
 * module calling its own helper is the helper's change, read where it's defined; a call into
 * another file is where this code starts handling the credential.
 */
const namesWhere =
  (fits: (words: readonly string[]) => boolean) =>
  (line: string, defined: ReadonlySet<string>): string[] => {
    const own = definedNames(line);
    const calls = calledNames(line).filter((name) => !defined.has(name) || own.includes(name));
    return [...own, ...calls].filter((name) => fits(pathWords(name)));
  };

/**
 * Credential handling an ordinary path doesn't name, found by the shape of the names a hunk
 * changes. A noun has to end the name, so `save_token_count` is a count, not a token; a verb has
 * to come with it, so `count_tokens` and `token_count` are not storage. An endpoint is a route
 * declaration that changes a credential, not a request a client sends to one. False matches only
 * ask for more attention.
 */
const CREDENTIAL_RULES: readonly {
  readonly found: (line: string, defined: ReadonlySet<string>) => string[];
  readonly reason: string;
}[] = [
  {
    found: namesWhere(
      (words) =>
        CREDENTIAL_NOUNS.has(words.at(-1) ?? "") &&
        words.slice(0, -1).some((word) => STORAGE_VERBS.has(word)),
    ),
    reason: "changes credential storage",
  },
  {
    found: namesWhere(
      (words) =>
        words.some((word) => AUTHORIZATION_WORDS.has(word)) ||
        (CREDENTIAL_NOUNS.has(words.at(-1) ?? "") && words.some((word) => CHECK_VERBS.has(word))),
    ),
    reason: "changes authorization",
  },
  {
    found: (line) =>
      routesOn(line)
        .filter(
          ({ method, path }) =>
            CHANGING_METHODS.has(method) &&
            path.split("/").some((segment) => CREDENTIAL_SEGMENT.test(segment)),
        )
        .map(({ method, path }) => `${method} ${path}`),
    reason: "changes a credential endpoint",
  },
];

/**
 * A rule on one hunk of a file, or a part of one: the reason when it matches, else null. `whole`
 * is the hunk the part is from, the hunk itself when it isn't split.
 */
type HunkRule = (hunk: Hunk, file: FileChange, whole: Hunk) => string | null;

const removedTests = (hunk: Hunk): number =>
  count(textOf(hunk, "del"), TEST_DECLARATIONS) - count(textOf(hunk, "add"), TEST_DECLARATIONS);

const HUNK_RULES: readonly HunkRule[] = [
  (hunk, file) => {
    if (isTestCode(file.path)) return null;
    const defined = definedInFile(file);
    const changed = [...textOf(hunk, "add"), ...textOf(hunk, "del")];
    const reasons = CREDENTIAL_RULES.flatMap(({ found, reason }) => {
      const names = [...new Set(changed.flatMap((line) => found(line, defined)))];
      return names.length === 0 ? [] : [`${reason} (${names.join(", ")})`];
    });
    return reasons.length === 0 ? null : reasons.join("; ");
  },
  (hunk) => {
    const added = textOf(hunk, "add");
    const labels = DANGEROUS_CALLS.filter(({ pattern }) =>
      added.some((line) => !IMPORT.test(line) && pattern.test(line)),
    ).map(({ label }) => label);
    return labels.length === 0 ? null : `adds ${labels.join(", ")}`;
  },
  (hunk, file, whole) => {
    if (!isTestFile(file.path)) return null;
    if (file.status === "deleted") return "removes tests";
    // An edited test deletes and adds its declaration line; only a net loss removes a test. A
    // split part can hold a renamed test's old line without its new one, so the loss is counted
    // over the whole hunk, and said on the parts that delete a test.
    return removedTests(whole) > 0 && count(textOf(hunk, "del"), TEST_DECLARATIONS) > 0
      ? "removes tests"
      : null;
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

/** The reasons the path rules give for a file: they hold for every hunk in it. */
export const pathReasons = (file: FileChange): string[] => {
  const paths = file.oldPath === null ? [file.path] : [file.path, file.oldPath];
  return PATH_RULES.flatMap(
    (rule) => paths.map(rule).find((reason): reason is string => reason !== null) ?? [],
  );
};

/**
 * The contract rules' reasons for a hunk, or for a part of one: a part's own lines name only the
 * definitions it changes, so its reasons don't repeat its hunk's other parts. `whole` is the hunk
 * a part is from, for the rules that need all of it.
 */
export const ruleReasons = (hunk: Hunk, file: FileChange, whole: Hunk = hunk): string[] => {
  const inert = inertOnly(hunk, file);
  return [
    ...new Set([
      ...pathReasons(file).filter((reason) => reason !== SECURITY_PATH || !inert),
      ...HUNK_RULES.flatMap((rule) => rule(hunk, file, whole) ?? []),
    ]),
  ];
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
  files.flatMap((file) =>
    file.hunks
      .filter((hunk) => !mechanicalHunkIds.has(hunk.id))
      .map((hunk): RiskAssessment => {
        const reasons = ruleReasons(hunk, file);
        return reasons.length === 0
          ? { hunkId: hunk.id, riskClass: "logic", reason: NO_RULE, source: "rule" }
          : {
              hunkId: hunk.id,
              riskClass: "contract",
              reason: reasons.join("; "),
              source: "rule",
            };
      }),
  );
