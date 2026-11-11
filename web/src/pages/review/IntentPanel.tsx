import type {
  Intent,
  IntentMismatchKind,
  IntentSourceKind,
  StatedIntent,
  Ticket,
} from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { CHIP } from "./StatedIntent.tsx";

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

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const MISMATCH_TONES: Readonly<Record<IntentMismatchKind, string>> = {
  contradicts: "text-review-changes bg-review-changes-bg border-review-changes/25",
  missing: "text-review-pending bg-review-pending-bg border-review-pending/25",
  unrequested: "text-review-pending bg-review-pending-bg border-review-pending/25",
};

const MODEL_TEXT = "whitespace-pre-line";
const HEADING = "text-caption font-medium text-muted-foreground";

const TicketChip = ({ ticketKey, ticket }: { ticketKey: string; ticket: Ticket | undefined }) =>
  ticket === undefined ? (
    <li className={CHIP} title="Jira didn't return this ticket, or Jira isn't configured">
      {ticketKey} · not fetched
    </li>
  ) : (
    <li className={CHIP}>
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
      <ul className="flex flex-wrap gap-2" aria-label="Sources">
        {stated.sources.map((source) =>
          source.kind === "ticket" && source.ref !== null ? (
            <TicketChip
              key={`ticket:${source.ref}`}
              ticketKey={source.ref}
              ticket={ticketOf.get(source.ref)}
            />
          ) : source.kind === "ticket" ? null : (
            <li key={source.kind} className={CHIP}>
              {SOURCE_NAMES[source.kind]}
            </li>
          ),
        )}
      </ul>
    )}
    {unfetched.length > 0 && (
      <ul className="flex flex-wrap gap-2" aria-label="Tickets mentioned but not fetched">
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
    <div className="flex flex-col gap-4 text-body">
      {mismatches.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p>
            {stated === null ? (
              <span className="font-medium">From the code:</span>
            ) : (
              <span className="font-medium text-review-approved">✓ Does what was asked:</span>
            )}{" "}
            <span className={MODEL_TEXT}>{inferred.summary}</span>
          </p>
          {stated === null && <p className="text-muted-foreground">{NO_STATED_INTENT}</p>}
          {sources}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <h3 className={HEADING}>Stated</h3>
            {stated === null ? (
              <p className="text-muted-foreground">{NO_STATED_INTENT}</p>
            ) : (
              <p className={MODEL_TEXT}>{stated.summary}</p>
            )}
            {sources}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className={HEADING}>Inferred from the code</h3>
            <p className={MODEL_TEXT}>{inferred.summary}</p>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className={HEADING}>Mismatches</h3>
            <ul className="flex flex-col gap-1.5">
              {mismatches.map((mismatch, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: mismatches have no ID and never reorder.
                <li key={index}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-1 rounded-md border p-2 text-left hover:bg-accent"
                    onClick={() => onSelectMismatch(index)}
                  >
                    <span
                      className={cn(
                        "rounded-full border px-2 text-caption font-medium",
                        MISMATCH_TONES[mismatch.kind],
                      )}
                    >
                      <span aria-hidden="true">⚠ </span>
                      {MISMATCH_NAMES[mismatch.kind]}
                    </span>
                    <span className={MODEL_TEXT}>{mismatch.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {(hiddenStated !== null || behaviorChanges.length > 0) && (
        <details className="flex flex-col gap-2">
          <summary className="min-h-6 cursor-pointer font-medium">
            Details{behaviorChanges.length > 0 && ` (${behaviorChanges.length})`}
          </summary>
          {hiddenStated !== null && (
            <>
              <h3 className={cn(HEADING, "mt-2")}>Asked</h3>
              <p className={MODEL_TEXT}>{hiddenStated.summary}</p>
            </>
          )}
          {behaviorChanges.length > 0 && (
            <>
              <h3 className={cn(HEADING, "mt-2")}>Behavior changes</h3>
              <ul className="list-disc pl-5">
                {behaviorChanges.map((change, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the list never reorders.
                  <li key={index} className={MODEL_TEXT}>
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
