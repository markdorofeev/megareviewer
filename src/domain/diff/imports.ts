/**
 * Which changed files an import makes names visible from. This links hunks for the reader; it
 * isn't a module resolver. It errs toward no link: a missing link hides no code, and a wrong one
 * sends the reviewer to code that has nothing to do with the line they're on.
 */
export interface SymbolImport {
  /** The module as written, without quotes: "./client.ts", "..models", "github.com/a/b". */
  readonly module: string;
  /** The names it imports, or null when it makes the whole module available. */
  readonly names: readonly string[] | null;
}

/** The changed files an import reaches: for names used on their own, and for members after a dot. */
export interface ImportReach {
  readonly names: readonly string[] | null;
  readonly name: (path: string) => boolean;
  readonly member: (path: string) => boolean;
}

const FAMILIES: Readonly<Record<string, string>> = {
  typescript: "javascript",
  tsx: "javascript",
  javascript: "javascript",
};

/** Languages that can use each other's names without crossing a process boundary. */
export const languageFamily = (language: string): string => FAMILIES[language] ?? language;

/** Languages whose imports are read. The others link by name within the language. */
const RESOLVED = new Set(["typescript", "tsx", "javascript", "python", "go", "java"]);

export const resolvesImports = (language: string): boolean => RESOLVED.has(language);

/** Languages where the files of one directory are one package and see each other's names. */
const DIRECTORY_PACKAGES = new Set(["go", "java"]);

export const sharesPackage = (language: string, from: string, to: string): boolean =>
  DIRECTORY_PACKAGES.has(language) && dirname(from) === dirname(to);

// Repository paths are always "/"-separated.
const dirname = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), 0));
const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const join = (dir: string, path: string): string => (dir === "" ? path : `${dir}/${path}`);

/** A file's path without its extension, so "src/a.ts" and "src/a.d.ts" are both "src/a". */
const stem = (path: string): string => {
  const name = basename(path).replace(/\.d\.ts$/, "");
  const dot = name.lastIndexOf(".");
  return join(dirname(path), dot <= 0 ? name : name.slice(0, dot));
};

/** Resolves "." and ".." against a directory; null when it climbs out of the repository. */
const resolve = (dir: string, relative: string): string | null => {
  const parts = dir === "" ? [] : dir.split("/");
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
};

/**
 * Whether a file is the module at `target` or inside it, as a package or behind an index file.
 * An anchored target is a repository path; an unanchored one may sit under any directory, for
 * absolute imports whose root we don't know.
 */
const covers = (path: string, target: string, anchored: boolean): boolean => {
  const module = /(^|\/)(index|__init__)$/.test(target) ? dirname(target) : target;
  const at = anchored
    ? stem(path) === target
    : stem(path) === target || stem(path).endsWith(`/${target}`);
  const inside = anchored
    ? module === "" || path.startsWith(`${module}/`)
    : path.startsWith(`${module}/`) || path.includes(`/${module}/`);
  return at || inside;
};

const JS_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

const javascriptReach = (from: string, { module, names }: SymbolImport): ImportReach | null => {
  const bare = module.replace(JS_EXTENSION, "");
  if (bare.startsWith(".")) {
    const target = resolve(dirname(from), bare);
    if (target === null) return null;
    const reaches = (path: string) => covers(path, target, true);
    return { names, name: reaches, member: reaches };
  }
  // A path alias such as "@/lib/text" or "~/lib/text". A package name has no slash to match on.
  const aliased = bare.replace(/^[@~#]\//, "");
  if (!aliased.includes("/")) return null;
  const reaches = (path: string) => covers(path, aliased, false);
  return { names, name: reaches, member: reaches };
};

const pythonReach = (from: string, { module, names }: SymbolImport): ImportReach | null => {
  const dots = /^\.*/.exec(module)?.[0].length ?? 0;
  const rest = module.slice(dots).replaceAll(".", "/");
  let target: string | null = rest;
  if (dots > 0) {
    const base = resolve(dirname(from), "../".repeat(dots - 1));
    target = base === null ? null : join(base, rest).replace(/\/$/, "");
  }
  if (target === null) return null;
  const anchored = dots > 0;
  const resolved = target;
  const within = (path: string, module: string) => covers(path, module, anchored);
  // The module file itself, or the package's __init__, without the rest of the package.
  const isModule = (path: string) =>
    [resolved, join(resolved, "__init__")].some((name) =>
      anchored ? stem(path) === name : stem(path) === name || stem(path).endsWith(`/${name}`),
    );
  return {
    names,
    name: (path) => within(path, resolved),
    // `from pkg import mod` imports a module, so `mod.f()` reaches pkg/mod.py.
    member: (path) =>
      names === null
        ? within(path, resolved)
        : isModule(path) || names.some((name) => within(path, join(resolved, name))),
  };
};

const goReach = ({ module }: SymbolImport): ImportReach => {
  const reaches = (path: string) => {
    const dir = dirname(path);
    return dir !== "" && (module === dir || module.endsWith(`/${dir}`));
  };
  return { names: null, name: reaches, member: reaches };
};

const javaReach = ({ module, names }: SymbolImport): ImportReach => {
  const path = module.replaceAll(".", "/");
  const reaches = names?.includes("*")
    ? (file: string) => dirname(file) === path || dirname(file).endsWith(`/${path}`)
    : (file: string) =>
        // `import static a.b.C.m` names a member of a/b/C.
        [path, dirname(path)].some(
          (target) => target !== "" && (stem(file) === target || stem(file).endsWith(`/${target}`)),
        );
  return { names: null, name: reaches, member: reaches };
};

/** What an import in `from` reaches, or null when it can't reach a file in the repository. */
export const importReach = (
  from: string,
  language: string,
  symbolImport: SymbolImport,
): ImportReach | null => {
  switch (languageFamily(language)) {
    case "javascript":
      return javascriptReach(from, symbolImport);
    case "python":
      return pythonReach(from, symbolImport);
    case "go":
      return goReach(symbolImport);
    case "java":
      return javaReach(symbolImport);
    default:
      return null;
  }
};
