import type { PullRequest, Ticket } from "../../../../src/domain/review/index.ts";

export const CHIP = "rounded-full border bg-muted px-2 py-0.5 text-caption";

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
    <div className="flex flex-col gap-3">
      {description === "" ? (
        <p className="text-muted-foreground">The pull request has no description.</p>
      ) : (
        <p className="text-body whitespace-pre-line">{description}</p>
      )}
      {(tickets.length > 0 || missingTicketKeys.length > 0) && (
        <ul className="flex flex-wrap gap-2" aria-label="Tickets">
          {tickets.map((ticket) => (
            <li key={ticket.key} className={CHIP}>
              <a href={ticket.url} target="_blank" rel="noreferrer">
                {ticket.key} · {ticket.summary}
              </a>
            </li>
          ))}
          {missingTicketKeys.map((key) => (
            <li
              key={key}
              className={CHIP}
              title="Jira didn't return this ticket, or Jira isn't configured"
            >
              {key} · not fetched
            </li>
          ))}
        </ul>
      )}
      {pullRequest.commits.length > 0 && (
        <details className="group">
          <summary className="min-h-6 cursor-pointer font-medium">
            Commits ({pullRequest.commits.length})
          </summary>
          <ol className="mt-1 flex flex-col gap-1">
            {pullRequest.commits.map((commit) => (
              <li key={commit.sha}>
                <code className="font-mono text-code-compact text-muted-foreground">
                  {commit.sha.slice(0, 7)}
                </code>{" "}
                {commit.message.split("\n")[0]}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
};
