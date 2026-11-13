// Enforces the layering in ENGINEERING.md §3 and the module boundaries in §4.

const TEST_FILE = "\\.test\\.tsx?$";
// Unanchored, because pnpm resolves packages to node_modules/.pnpm/<name>@<version>/node_modules/<name>/.
const ZOD = "node_modules/zod/";
const VITEST = "node_modules/vitest/";
const CONTRACT_SUITES = "^src/application/testing/contracts/";
const MODULE = "src/(?:domain|application|adapters)/[^/]+";

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-is-pure",
      comment: "The domain imports only itself and Zod: no I/O, no frameworks, no outer layers.",
      severity: "error",
      from: { path: "^src/domain/", pathNot: TEST_FILE },
      to: { pathNot: [`^src/domain/`, ZOD] },
    },
    {
      name: "application-depends-on-domain",
      comment: "Use cases reach the outside world only through ports.",
      severity: "error",
      from: { path: "^src/application/", pathNot: [TEST_FILE, CONTRACT_SUITES] },
      to: { pathNot: [`^src/(domain|application)/`, ZOD] },
    },
    {
      name: "contract-suites-depend-on-domain",
      comment: "Port contract suites register Vitest tests, which adapters' tests run.",
      severity: "error",
      from: { path: CONTRACT_SUITES },
      to: { pathNot: [`^src/(domain|application)/`, ZOD, VITEST] },
    },
    {
      name: "adapters-are-isolated",
      comment: "An adapter never imports another adapter.",
      severity: "error",
      from: { path: "^src/adapters/([^/]+)/" },
      to: { path: "^src/adapters/", pathNot: "^src/adapters/$1/" },
    },
    {
      name: "adapters-are-isolated",
      comment: "Only the composition root knows about adapters, not the other way round.",
      severity: "error",
      from: { path: "^src/adapters/" },
      to: { path: "^src/cli/" },
    },
    {
      name: "only-http-uses-contracts",
      comment: "The HTTP API contract is translated in the http adapter and nowhere else.",
      severity: "error",
      from: { path: "^src/adapters/(?!http/)" },
      to: { path: "^contracts/" },
    },
    {
      name: "contracts-are-pure",
      comment: "Contracts are schemas over domain types, shared with the web.",
      severity: "error",
      from: { path: "^contracts/", pathNot: TEST_FILE },
      to: { pathNot: ["^contracts/", "^src/domain/", ZOD] },
    },
    {
      name: "web-uses-contracts",
      comment: "The web talks to the server only through the HTTP API contract.",
      severity: "error",
      from: { path: "^web/src/" },
      to: { path: "^src/(application|adapters|cli)/" },
    },
    {
      name: "web-dev-uses-contracts",
      comment:
        "The mock API may share the dev fakes under src/cli/dev (the scenarios the replayed " +
        "model plays), which aren't bundled, but nothing else of the server's.",
      severity: "error",
      from: { path: "^web/dev/" },
      to: { path: "^src/(application|adapters|cli)/", pathNot: "^src/cli/dev/" },
    },
    {
      name: "no-deep-imports",
      comment: "Another module is imported through its index.ts only.",
      severity: "error",
      from: { path: `^(${MODULE})/` },
      to: { path: `^${MODULE}/`, pathNot: ["^$1/", `^${MODULE}/index\\.ts$`] },
    },
    {
      name: "no-deep-imports",
      comment: "A module is imported through its index.ts only.",
      severity: "error",
      from: { pathNot: `^${MODULE}/` },
      to: { path: `^${MODULE}/`, pathNot: `^${MODULE}/index\\.ts$` },
    },
    {
      name: "testing-is-for-tests",
      comment: "Fakes are for tests, the dev server and evals, never for production code.",
      severity: "error",
      from: { pathNot: [TEST_FILE, "^src/application/testing/", "^src/cli/dev/", "^evals/"] },
      to: { path: "^src/application/testing/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
