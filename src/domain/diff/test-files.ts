// Repository paths are always "/"-separated.
const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const directories = (path: string): string[] => path.split("/").slice(0, -1);

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
