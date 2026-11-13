import { existsSync } from "node:fs";
import { chmod, cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { build } from "esbuild";
import { z } from "zod";

// Builds the npm package into dist/: the UI, one bundled server file with no runtime
// dependencies, the tree-sitter grammars, and the notices of everything bundled.

const DIST = "dist";
const GRAMMARS = "src/adapters/treesitter/grammars";
/** Kept in the repo for maintainers, not needed at runtime. The license texts go into the notices. */
const GRAMMAR_EXTRAS = new Set(["PROVENANCE.md", "refresh.sh", "licenses"]);

// The bundle is ESM, but CommonJS dependencies inside it call require().
const SERVER_BANNER = `import { createRequire as __megareviewerCreateRequire } from "node:module";
const require = __megareviewerCreateRequire(import.meta.url);`;

/** The package directory a bundled file comes from, or null for our own sources. */
export const packageRootOf = (file: string): string | null => {
  const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(file.replaceAll("\\", "/"));
  return match?.[1] ?? null;
};

export interface GrammarProvenance {
  readonly file: string;
  readonly source: string;
  readonly version: string;
  readonly license: string;
  /** Relative to the grammars folder. */
  readonly licenseFile: string;
}

export interface GrammarNotice extends GrammarProvenance {
  readonly text: string;
}

/** The grammars' table in PROVENANCE.md: file, [repo](url), version, [license](file), hash. */
export const parseProvenance = (markdown: string): GrammarProvenance[] =>
  [
    ...markdown.matchAll(
      /^\| `([^`]+\.wasm)` \| \[[^\]]+\]\(([^)]+)\)[^|]* \| ([^|]+) \| \[([^\]]+)\]\(([^)]+)\) \|/gm,
    ),
  ].map(([, file = "", source = "", version = "", license = "", licenseFile = ""]) => ({
    file,
    source,
    version: version.trim(),
    license,
    licenseFile,
  }));

export interface PackageNotice {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly text: string;
}

export const formatNotices = (
  packages: readonly PackageNotice[],
  grammars: readonly GrammarNotice[],
): string => {
  const rule = "-".repeat(78);
  const sections = packages.map(
    (notice) => `${notice.name} ${notice.version} (${notice.license})\n\n${notice.text.trim()}\n`,
  );
  const grammarLines = grammars.map(
    (grammar) => `${grammar.file}: ${grammar.version}, ${grammar.license}, ${grammar.source}`,
  );
  // tsx and typescript come from one repository, so they share one license text.
  const byLicenseFile = Map.groupBy(grammars, (grammar) => grammar.licenseFile);
  const grammarSections = [...byLicenseFile.values()].flatMap(([first, ...rest]) =>
    first === undefined
      ? []
      : [
          `${[first, ...rest].map((grammar) => grammar.file).join(", ")} (${first.license})\n\n${first.text.trim()}\n`,
        ],
  );
  return [
    "megareviewer bundles the following third-party software.\n",
    ...sections,
    `tree-sitter grammars in grammars/\n\n${grammarLines.join("\n")}\n`,
    ...grammarSections,
  ].join(`\n${rule}\n\n`);
};

const PackageJson = z.object({
  name: z.string(),
  version: z.string(),
  license: z.string().optional(),
  author: z.union([z.string(), z.object({ name: z.string() })]).optional(),
  repository: z.union([z.string(), z.object({ url: z.string() })]).optional(),
});
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

/**
 * Bundled packages checked by hand that ship no license file. Their notice is what their
 * package.json says. Any other package without one fails the build.
 */
const NO_LICENSE_FILE: ReadonlySet<string> = new Set([
  // Pulled in by @anthropic-ai/sdk. package.json says MIT; the upstream repo's LICENSE is Apache-2.0.
  "standardwebhooks",
]);

const readNotice = async (root: string): Promise<PackageNotice> => {
  const { name, version, license, author, repository } = PackageJson.parse(
    JSON.parse(await readFile(join(root, "package.json"), "utf8")),
  );
  const files = (await readdir(root)).filter((file) => LICENSE_FILE.test(file)).sort();
  if (files.length === 0) {
    // Shipping code without its notice breaks most licenses, so this is a reviewed exception.
    if (!NO_LICENSE_FILE.has(name))
      throw new Error(`${name} ${version} has no license file in ${root}`);
    const lines = [
      `${name} ships no license file. Its package.json declares the license ${license ?? "(none)"}.`,
      ...(author === undefined
        ? []
        : [`Author: ${typeof author === "string" ? author : author.name}`]),
      ...(repository === undefined
        ? []
        : [`Source: ${typeof repository === "string" ? repository : repository.url}`]),
    ];
    return { name, version, license: license ?? "unknown", text: lines.join("\n") };
  }
  const texts = await Promise.all(files.map((file) => readFile(join(root, file), "utf8")));
  return { name, version, license: license ?? "see text", text: texts.join("\n\n") };
};

/** Every .wasm we ship needs a row in PROVENANCE.md and the license text it links to. */
const readGrammarNotices = async (): Promise<GrammarNotice[]> => {
  const provenance = parseProvenance(await readFile(join(GRAMMARS, "PROVENANCE.md"), "utf8"));
  const listed = new Set(provenance.map((grammar) => grammar.file));
  const unlisted = (await readdir(GRAMMARS)).filter(
    (file) => file.endsWith(".wasm") && !listed.has(file),
  );
  if (unlisted.length > 0) {
    throw new Error(
      `No license in ${GRAMMARS}/PROVENANCE.md for ${unlisted.join(", ")}: each row needs [license](file)`,
    );
  }
  return Promise.all(
    provenance.map(async (grammar) => ({
      ...grammar,
      text: await readFile(join(GRAMMARS, grammar.licenseFile), "utf8"),
    })),
  );
};

/** Returns the files the UI bundled. */
const buildWeb = async (): Promise<string[]> => {
  const configFile = "web/vite.config.ts";
  if (!existsSync("web/index.html") || !existsSync(configFile)) {
    console.warn("No web/index.html or web/vite.config.ts yet: the package has no UI.");
    return [];
  }
  const { build: viteBuild } = await import("vite");
  const result = await viteBuild({
    configFile,
    logLevel: "warn",
    build: { outDir: resolve(DIST, "web"), emptyOutDir: true },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) =>
    "output" in output ? output.output : [],
  );
  return outputs.flatMap((chunk) => (chunk.type === "chunk" ? chunk.moduleIds : []));
};

/**
 * dist/cli.js is a small launcher that checks the Node version, built for old Node so it can
 * say why it won't run. It then loads dist/server.js, the bundle of everything else.
 */
const buildServer = async (): Promise<string[]> => {
  const shared = {
    bundle: true,
    platform: "node",
    format: "esm",
    // Not minified: users can read what they run.
    minify: false,
    metafile: true,
    logLevel: "warning",
  } as const;
  const [launcher, server] = await Promise.all([
    build({
      ...shared,
      entryPoints: ["src/cli/bin.ts"],
      outfile: join(DIST, "cli.js"),
      target: "node18",
      banner: { js: "#!/usr/bin/env node" },
    }),
    build({
      ...shared,
      entryPoints: ["src/cli/main.ts"],
      outfile: join(DIST, "server.js"),
      target: "node22",
      banner: { js: SERVER_BANNER },
    }),
  ]);
  await chmod(join(DIST, "cli.js"), 0o755);
  return [...Object.keys(launcher.metafile.inputs), ...Object.keys(server.metafile.inputs)];
};

const main = async () => {
  await rm(DIST, { recursive: true, force: true });
  const bundled = [...(await buildWeb()), ...(await buildServer())];

  await cp(GRAMMARS, join(DIST, "grammars"), {
    recursive: true,
    filter: (source) => !GRAMMAR_EXTRAS.has(basename(source)),
  });

  const roots = [...new Set(bundled.flatMap((file) => packageRootOf(file) ?? []))].sort();
  const notices = await Promise.all(roots.map(readNotice));
  const grammars = await readGrammarNotices();
  await writeFile(join(DIST, "THIRD_PARTY_LICENSES.txt"), formatNotices(notices, grammars));
  console.log(
    `Built ${DIST}/ with ${notices.length} bundled packages and ${grammars.length} grammars.`,
  );
};

if (import.meta.main) await main();
