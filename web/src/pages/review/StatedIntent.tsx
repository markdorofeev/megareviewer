import type { PullRequest, Ticket } from "../../../../src/domain/review/index.ts";

/**
 * What the pull request says it does, as written, when there's no model to read it: the
 * description, the linked tickets and the commits. Text only, never HTML, because PR content is
 * untrusted.
 */
export const StatedIntent = ({
  pullRequest,
  tickets,
  missingTicketKeys,
}: {
  readonly pullRequest: PullRequest;
  readonly tickets: readonly Ticket[];
  readonly missingTicketKeys: readonly string[];
}) => {
  const description = pullRequest.description.trim();
  return (
    <div className="intent-panel stated-intent">
      {description === "" ? (
        <p className="muted">The pull request has no description.</p>
      ) : (
        <p className="pr-description">{description}</p>
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
    </div>
  );
};
