import type { ImportReach, SymbolImport } from "./imports.ts";

/** What decides where a member reached through a receiver can be. */
export interface ReceiverScope {
  readonly language: string;
  /** The classes and types the caller's file and the pull request define. */
  readonly types: ReadonlySet<string>;
  readonly imports: readonly SymbolImport[];
  /** What each of `imports` reaches, null where it reaches no file of the repository. */
  readonly reaches: readonly (ImportReach | null)[];
}

/** A Java type's name: capitalized, with a lowercase letter, so not a constant's. */
const JAVA_TYPE = /^[A-Z][A-Za-z0-9_$]*[a-z][A-Za-z0-9_$]*$/;

/** The last name of a module, which `import a.b.C` and `from a import b` bring into scope. */
const lastName = (module: string): string => module.split(/[./]/).at(-1) ?? module;

/** Whether an import brings `name` into the file's scope. */
const imports = (symbolImport: SymbolImport, name: string): boolean =>
  symbolImport.names === null
    ? lastName(symbolImport.module) === name
    : symbolImport.names.includes(name);

/**
 * Whether a member, written after `receiver`, can be a definition in the file at `path` inside a
 * class or type named `owner`. A receiver that's a class or type of the pull request reaches only
 * its own members; one the file imports reaches only what that import reaches; in Java, a type's
 * name that's neither, `NodeClass` or `Math`, is a class outside the pull request and reaches
 * nothing. Anything else, a variable, `this`, a call, or no receiver, reaches as before.
 */
export const receiverReaches = (
  receiver: string | null | undefined,
  scope: ReceiverScope,
  path: string,
  owner: string | null,
): boolean => {
  if (receiver === undefined || receiver === null) return true;
  if (scope.types.has(receiver)) return owner === receiver;
  const imported = scope.imports.flatMap((one, at) =>
    imports(one, receiver) ? [scope.reaches[at] ?? null] : [],
  );
  if (imported.length > 0) return imported.some((reach) => reach?.member(path) === true);
  return !(scope.language === "java" && JAVA_TYPE.test(receiver));
};
