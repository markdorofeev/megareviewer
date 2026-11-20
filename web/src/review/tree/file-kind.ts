import type { FileStatus } from "../../../../src/domain/diff/index.ts";
import { isTestFile } from "../../../../src/domain/diff/index.ts";

// Which of IntelliJ IDEA's icons a file or a directory gets, and the words for it.

/** An icon in ./icons, by its file name without `.svg`. */
export type IconName =
  | "class"
  | "java"
  | "kotlin"
  | "typeScript"
  | "javaScript"
  | "json"
  | "yaml"
  | "markdown"
  | "xml"
  | "properties"
  | "shell"
  | "python"
  | "text"
  | "unknown"
  | "folder"
  | "package"
  | "module";

export interface FileKind {
  readonly icon: IconName;
  /** IDEA's test mark over the icon, as it layers it on a test class. */
  readonly testMark: boolean;
  /** What the file is, for screen readers. */
  readonly label: string;
}

const BY_EXTENSION: Readonly<Record<string, readonly [IconName, string]>> = {
  kt: ["kotlin", "Kotlin"],
  kts: ["kotlin", "Kotlin"],
  ts: ["typeScript", "TypeScript"],
  tsx: ["typeScript", "TypeScript"],
  mts: ["typeScript", "TypeScript"],
  cts: ["typeScript", "TypeScript"],
  js: ["javaScript", "JavaScript"],
  jsx: ["javaScript", "JavaScript"],
  mjs: ["javaScript", "JavaScript"],
  cjs: ["javaScript", "JavaScript"],
  json: ["json", "JSON"],
  jsonc: ["json", "JSON"],
  yml: ["yaml", "YAML"],
  yaml: ["yaml", "YAML"],
  md: ["markdown", "Markdown"],
  xml: ["xml", "XML"],
  properties: ["properties", "Properties"],
  sh: ["shell", "Shell script"],
  bash: ["shell", "Shell script"],
  py: ["python", "Python"],
  pyi: ["python", "Python"],
  txt: ["text", "Text"],
};

export const fileKind = (path: string, status?: FileStatus): FileKind => {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name.endsWith(".java")) {
    // A deleted file has no class left to show, so IDEA shows the file type.
    if (status === "deleted") return { icon: "java", testMark: false, label: "Java file" };
    return isTestFile(path)
      ? { icon: "class", testMark: true, label: "Java test class" }
      : { icon: "class", testMark: false, label: "Java class" };
  }
  if (/\/meta-inf\/services\//i.test(`/${path}`))
    return { icon: "text", testMark: false, label: "Text" };
  const extension = /\.([a-z0-9]+)$/.exec(name)?.[1] ?? "";
  const [icon, label] = BY_EXTENSION[extension] ?? ["unknown", "File"];
  return { icon, testMark: false, label };
};

/** A directory named as a Java package, such as a module `com.oracle.svm.core`. */
const DOTTED = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
/** Inside a Java or Kotlin source root, not the root itself. */
const UNDER_SOURCE_ROOT = /(^|\/)src\/(main|test)\/(java|kotlin)\/./;

export type FolderKind = "module" | "package" | "folder";

/**
 * A directory's icon: a module is a dotted directory with a `src/` in it, a package is inside a
 * module or under a Java or Kotlin source root, and anything else is a folder. `path` is the
 * directory as the tree shows it, its module's repeated path left out or not; `paths` are the
 * PR's files.
 */
export const folderKind = (path: string, paths: readonly string[]): FolderKind => {
  // Resource directories such as META-INF are plain folders in IDEA, even inside a module.
  if (/(^|\/)META-INF(\/|$)/.test(path)) return "folder";
  const segments = path.split("/");
  const isModule = (at: number) => {
    const prefix = `${segments.slice(0, at + 1).join("/")}/src/`;
    return DOTTED.test(segments[at] ?? "") && paths.some((one) => one.startsWith(prefix));
  };
  if (isModule(segments.length - 1)) return "module";
  if (UNDER_SOURCE_ROOT.test(path)) return "package";
  return segments.slice(0, -1).some((_, at) => isModule(at)) ? "package" : "folder";
};
