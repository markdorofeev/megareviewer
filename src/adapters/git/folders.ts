import { readdir, readFile } from "node:fs/promises";

/** A symlink is neither: it isn't followed. */
export interface FolderEntry {
  readonly name: string;
  readonly kind: "folder" | "file" | "other";
}

/** The file system as the search for clones reads it. */
export interface Folders {
  /** Empty when the folder can't be opened. */
  list(dir: string): Promise<readonly FolderEntry[]>;
  /** Null when the file can't be read. */
  readText(path: string): Promise<string | null>;
}

export const nodeFolders: Folders = {
  async list(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "folder" : entry.isFile() ? "file" : "other",
      }));
    } catch {
      return [];
    }
  },

  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  },
};
