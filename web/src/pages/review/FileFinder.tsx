import { useState } from "react";
import type { FileChange } from "../../../../src/domain/diff/index.ts";
import { Dialog } from "./Dialog.tsx";

/** Files the finder lists at most. */
const MAX_RESULTS = 20;

/** Changed files whose path contains every typed word, in path order. */
export const findFiles = (files: readonly FileChange[], query: string): FileChange[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return files
    .filter((file) => {
      const path = file.path.toLowerCase();
      return words.every((word) => path.includes(word));
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, MAX_RESULTS);
};

/** Jumps to a changed file: type part of its path, Enter takes the first match. */
export const FileFinder = ({
  files,
  onPick,
  onClose,
}: {
  readonly files: readonly FileChange[];
  readonly onPick: (file: FileChange) => void;
  readonly onClose: () => void;
}) => {
  const [query, setQuery] = useState("");
  const matches = findFiles(files, query);
  return (
    <Dialog title="Go to file" onClose={onClose} className="file-finder">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const [first] = matches;
          if (first !== undefined) onPick(first);
        }}
      >
        <input
          type="search"
          className="input"
          aria-label="File path"
          placeholder="src/routes/orders"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-autofocus
        />
      </form>
      {matches.length === 0 ? (
        <p className="muted">No changed file matches.</p>
      ) : (
        <ul className="file-matches">
          {matches.map((file) => (
            <li key={file.path}>
              <button type="button" className="file-match" onClick={() => onPick(file)}>
                {file.path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
};
