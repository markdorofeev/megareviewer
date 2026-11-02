import { useEffect, useId, useState } from "react";
import type { AnalysisId, PullRequest, Ticket } from "../../../../src/domain/review/index.ts";
import { parseBoolean, useStoredState } from "./storage.ts";

/**
 * What the pull request says it does, as written, when there's no model to read it: the
 * description, the linked tickets and the commits. Text only, never HTML, because PR content is
 * untrusted. After the first visit the description is cut to its first lines.
 */
export const StatedIntent = ({
  analysisId,
  pullRequest,
  tickets,
  missingTicketKeys,
}: {
  readonly analysisId: AnalysisId;
  readonly pullRequest: PullRequest;
  readonly tickets: readonly Ticket[];
  readonly missingTicketKeys: readonly string[];
}) => {
  const id = useId();
  const [seen, setSeen] = useStoredState(`intent-seen:${analysisId}`, false, parseBoolean);
  // Whether it was seen when the page opened: marking it seen doesn't cut it while it's read.
  const [cut] = useState(seen);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setSeen(() => true), [setSeen]);

  const description = pullRequest.description.trim();
  const clamped = cut && !expanded;
  return (
    <section className="intent-panel stated-intent" aria-labelledby={`${id}-title`}>
      <div className="panel-header">
        <h2 id={`${id}-title`}>What was asked</h2>
      </div>
      {description === "" ? (
        <p className="muted">The pull request has no description.</p>
      ) : (
        <>
          <p className={`pr-description${clamped ? " clamped" : ""}`}>{description}</p>
          {cut && (
            <button type="button" className="button quiet" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : "Show all"}
            </button>
          )}
        </>
      )}
      {(tickets.length > 0 || missingTicketKeys.length > 0) && (
        <ul className="chips" aria-label="Tickets">
          {tickets.map((ticket) => (
            <li key={ticket.key} className="chip">
              <a href={ticket.url} target="_blank" rel="noreferrer">
                {ticket.key} · {ticket.summary}
              </a>
            </li>
          ))}
          {missingTicketKeys.map((key) => (
            <li
              key={key}
              className="chip"
              title="Jira didn't return this ticket, or Jira isn't configured"
            >
              {key} · not fetched
            </li>
          ))}
        </ul>
      )}
      {pullRequest.commits.length > 0 && (
        <details className="intent-details">
          <summary>Commits ({pullRequest.commits.length})</summary>
          <ol className="commit-list">
            {pullRequest.commits.map((commit) => (
              <li key={commit.sha}>
                <code>{commit.sha.slice(0, 7)}</code> {commit.message.split("\n")[0]}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
};
