import type {
  Intent,
  IntentMismatchKind,
  IntentSourceKind,
  StatedIntent,
  Ticket,
} from "../../../../src/domain/review/index.ts";

const SOURCE_NAMES: Readonly<Record<Exclude<IntentSourceKind, "ticket">, string>> = {
  description: "Description",
  commits: "Commits",
  branch: "Branch name",
};

const MISMATCH_NAMES: Readonly<Record<IntentMismatchKind, string>> = {
  unrequested: "Unrequested",
  missing: "Missing",
  contradicts: "Contradicts",
};

const TicketChip = ({ ticketKey, ticket }: { ticketKey: string; ticket: Ticket | undefined }) =>
  ticket === undefined ? (
    <li className="chip" title="Jira didn't return this ticket, or Jira isn't configured">
      {ticketKey} · not fetched
    </li>
  ) : (
    <li className="chip">
      <a href={ticket.url} target="_blank" rel="noreferrer" title={ticket.summary}>
        {ticket.key} · {ticket.status}
      </a>
    </li>
  );

const Sources = ({
  stated,
  ticketOf,
  unfetched,
}: {
  readonly stated: StatedIntent | null;
  readonly ticketOf: ReadonlyMap<string, Ticket>;
  readonly unfetched: readonly string[];
}) => (
  <>
    {stated !== null && (
      <ul className="chips" aria-label="Sources">
        {stated.sources.map((source) =>
          source.kind === "ticket" && source.ref !== null ? (
            <TicketChip
              key={`ticket:${source.ref}`}
              ticketKey={source.ref}
              ticket={ticketOf.get(source.ref)}
            />
          ) : source.kind === "ticket" ? null : (
            <li key={source.kind} className="chip">
              {SOURCE_NAMES[source.kind]}
            </li>
          ),
        )}
      </ul>
    )}
    {unfetched.length > 0 && (
      <ul className="chips" aria-label="Tickets mentioned but not fetched">
        {unfetched.map((key) => (
          <TicketChip key={key} ticketKey={key} ticket={undefined} />
        ))}
      </ul>
    )}
  </>
);

const NO_STATED_INTENT = "No stated intent: the PR has no description or linked tickets.";

/**
 * What was asked and what the code does, in full, for the intent's details. When they agree it's
 * one line, because the same intent said twice is noise; side by side only when there are
 * mismatches, which are the finding.
 */
export const IntentPanel = ({
  intent,
  tickets,
  missingTicketKeys,
  onSelectMismatch,
}: {
  readonly intent: Intent;
  readonly tickets: readonly Ticket[];
  readonly missingTicketKeys: readonly string[];
  readonly onSelectMismatch: (index: number) => void;
}) => {
  const { stated, inferred, mismatches } = intent;
  const ticketOf = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  const statedKeys = new Set(stated?.sources.flatMap((source) => source.ref ?? []) ?? []);
  // Ticket keys found in the PR that Jira didn't return still show, so nothing goes unmentioned.
  const unfetched = missingTicketKeys.filter((key) => !statedKeys.has(key));
  const sources = <Sources stated={stated} ticketOf={ticketOf} unfetched={unfetched} />;
  // On one line the stated summary isn't shown, so it moves into the details.
  const hiddenStated = mismatches.length === 0 ? stated : null;
  const { behaviorChanges } = inferred;

  return (
    <div className="intent-panel">
      {mismatches.length === 0 ? (
        <div className="intent-agrees">
          <p>
            {stated === null ? (
              <span className="intent-label">From the code:</span>
            ) : (
              <span className="intent-label agrees">✓ Does what was asked:</span>
            )}{" "}
            <span className="model-text">{inferred.summary}</span>
          </p>
          {stated === null && <p className="muted">{NO_STATED_INTENT}</p>}
          {sources}
        </div>
      ) : (
        <div className="intent-columns">
          <div className="intent-column">
            <h3>Stated</h3>
            {stated === null ? (
              <p className="muted">{NO_STATED_INTENT}</p>
            ) : (
              <p className="model-text">{stated.summary}</p>
            )}
            {sources}
          </div>
          <div className="intent-column">
            <h3>Inferred from the code</h3>
            <p className="model-text">{inferred.summary}</p>
          </div>
          <div className="intent-column">
            <h3>Mismatches</h3>
            <ul className="mismatches">
              {mismatches.map((mismatch, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: mismatches have no ID and never reorder.
                <li key={index}>
                  <button
                    type="button"
                    className="mismatch"
                    onClick={() => onSelectMismatch(index)}
                  >
                    <span className={`badge mismatch-${mismatch.kind}`}>
                      {MISMATCH_NAMES[mismatch.kind]}
                    </span>
                    <span className="model-text">{mismatch.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {(hiddenStated !== null || behaviorChanges.length > 0) && (
        <details className="intent-details">
          <summary>Details{behaviorChanges.length > 0 && ` (${behaviorChanges.length})`}</summary>
          {hiddenStated !== null && (
            <>
              <h3>Asked</h3>
              <p className="model-text">{hiddenStated.summary}</p>
            </>
          )}
          {behaviorChanges.length > 0 && (
            <>
              <h3>Behavior changes</h3>
              <ul className="behavior-changes">
                {behaviorChanges.map((change, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the list never reorders.
                  <li key={index} className="model-text">
                    {change}
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
    </div>
  );
};
