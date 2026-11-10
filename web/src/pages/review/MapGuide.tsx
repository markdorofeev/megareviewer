import { useId, useState } from "react";
import type { PartId } from "../../../../src/domain/diff/index.ts";
import { GROUPINGS, type Grouping } from "./grouping.ts";
import type { ContractRow } from "./model.ts";

const GROUPING_LABELS: Readonly<Record<Grouping, string>> = {
  calls: "Calls",
  folders: "Folders",
};

/** Calls · Folders: how the map groups its files. */
export const GroupingToggle = ({
  grouping,
  onChange,
}: {
  readonly grouping: Grouping;
  readonly onChange: (grouping: Grouping) => void;
}) => {
  const name = useId();
  return (
    <div className="grouping-toggle" role="radiogroup" aria-label="Group files by">
      {GROUPINGS.map((one) => (
        <label key={one} className="grouping-option">
          <input
            type="radio"
            name={name}
            className="visually-hidden"
            checked={grouping === one}
            onChange={() => onChange(one)}
          />
          {GROUPING_LABELS[one]}
        </label>
      ))}
    </div>
  );
};

/** Rows the contract index shows before "N more". */
export const CONTRACT_ROWS_SHOWN = 6;

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Every contract part, one row each, above the map: the riskiest code first, a click away. */
export const ContractIndex = ({
  rows,
  onGo,
}: {
  readonly rows: readonly ContractRow[];
  readonly onGo: (id: PartId) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, CONTRACT_ROWS_SHOWN);
  const more = rows.length - shown.length;
  return (
    <nav className="contract-index" aria-label="Contract changes">
      <h2 className="contract-index-title">
        Contract changes <span className="muted">{rows.length}</span>
      </h2>
      <ul className="contract-index-list">
        {shown.map((row) => (
          <li key={row.partId}>
            <button
              type="button"
              className="contract-row"
              title={row.path}
              onClick={() => onGo(row.partId)}
            >
              <span className="contract-row-file">{baseName(row.path)}</span>
              <code className="contract-row-what">{row.what}</code>
              <span className="contract-row-reason">{row.reason}</span>
            </button>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button type="button" className="link-button" onClick={() => setExpanded(true)}>
          {more} more
        </button>
      )}
    </nav>
  );
};
