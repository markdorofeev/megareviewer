import { TriangleAlertIcon } from "lucide-react";
import { type RefObject, useId, useRef, useState } from "react";
import {
  MAX_PREFERENCE_TEXT,
  type PreferenceProposal,
  type ProposalId,
} from "../../../../src/domain/review/index.ts";
import { Button } from "../../ui/button.tsx";
import { PreferenceForm, type RuleFields, tooLong } from "./PreferenceForm.tsx";
import { KindChip, type ScopeOption, scopeKey } from "./rule.tsx";

/** What the reviewer decides on a proposal; each answers why it failed, or null. */
export interface ProposalActions {
  /** Accepts it as it reads, or with what the reviewer changed. */
  readonly onAccept: (id: ProposalId, changes: RuleFields | null) => Promise<string | null>;
  readonly onReject: (id: ProposalId) => Promise<string | null>;
}

const FROM: Readonly<Record<PreferenceProposal["source"], string>> = {
  learned: "from what you did in reviews",
  imported: "from your past reviews",
};

const Proposal = ({
  proposal,
  scopes,
  actions,
}: {
  readonly proposal: PreferenceProposal;
  readonly scopes: readonly ScopeOption[];
  readonly actions: ProposalActions;
}) => {
  const { id, kind, text, scope, evidence } = proposal;
  const over = text.length - MAX_PREFERENCE_TEXT;
  const [editing, setEditing] = useState<{ readonly note: string | null } | null>(null);
  const [pending, setPending] = useState<"accept" | "reject" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const where = scopes.find((option) => option.key === scopeKey(scope))?.label ?? "Everywhere";

  const decide = async (decision: "accept" | "reject") => {
    if (pending !== null) return;
    // A proposal's text is the model's, and can be longer than a preference's.
    if (decision === "accept" && over > 0) return setEditing({ note: tooLong(over) });
    setPending(decision);
    setFailure(null);
    const failed = await (decision === "accept"
      ? actions.onAccept(id, null)
      : actions.onReject(id));
    setPending(null);
    setFailure(failed);
  };

  if (editing !== null) {
    return (
      <li className="bg-surface-subtle px-4 py-3">
        <PreferenceForm
          legend={`Edit the suggestion: ${text}`}
          initial={proposal}
          scopes={scopes}
          submit="Accept"
          submitting="Accepting…"
          note={editing.note}
          onCancel={() => setEditing(null)}
          onSubmit={(fields) => actions.onAccept(id, fields)}
        />
      </li>
    );
  }
  return (
    <li data-slot="proposal" className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <KindChip kind={kind} />
        <span className="min-w-0 flex-1 basis-56 font-medium break-words">{text}</span>
        <span className="shrink-0 text-caption text-muted-foreground">
          {where}, {FROM[proposal.source]}
        </span>
      </div>
      {evidence.length > 0 && (
        <div className="flex gap-1.5 text-caption text-muted-foreground">
          <span className="shrink-0">Based on:</span>
          <ul className="flex min-w-0 flex-col">
            {[...new Set(evidence)].map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {failure !== null && (
          <span role="alert" className="min-w-0 flex-1 text-caption text-destructive">
            <TriangleAlertIcon aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
            {failure}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Reject: ${text}`}
          aria-busy={pending === "reject"}
          onClick={() => void decide("reject")}
        >
          {pending === "reject" ? "Rejecting…" : "Reject"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Edit: ${text}`}
          onClick={() => setEditing({ note: null })}
        >
          Edit
        </Button>
        <Button
          size="sm"
          aria-label={`Accept: ${text}`}
          aria-busy={pending === "accept"}
          onClick={() => void decide("accept")}
        >
          {pending === "accept" ? "Accepting…" : "Accept"}
        </Button>
      </div>
    </li>
  );
};

/**
 * The proposals waiting for the reviewer, shown only when there are some. Accept adds one as it
 * reads, Edit opens it in the form first, and Reject removes it for good.
 */
export const Suggested = ({
  proposals,
  scopes,
  actions,
  fallbackFocus,
}: {
  readonly proposals: readonly PreferenceProposal[];
  readonly scopes: readonly ScopeOption[];
  readonly actions: ProposalActions;
  /** What takes the focus when the last proposal is decided and the card goes. */
  readonly fallbackFocus?: RefObject<HTMLElement | null>;
}) => {
  const id = useId();
  const card = useRef<HTMLElement>(null);
  // A decided proposal leaves the page with the button that had the focus.
  const moveFocus = () => (proposals.length > 1 ? card.current : fallbackFocus?.current)?.focus();
  const decided = (decide: Promise<string | null>) =>
    decide.then((failed) => {
      if (failed === null) moveFocus();
      return failed;
    });
  const moving: ProposalActions = {
    onAccept: (proposalId, changes) => decided(actions.onAccept(proposalId, changes)),
    onReject: (proposalId) => decided(actions.onReject(proposalId)),
  };
  if (proposals.length === 0) return null;
  return (
    <section
      ref={card}
      tabIndex={-1}
      aria-labelledby={id}
      data-slot="suggested"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2">
        <h2 id={id} className="text-heading font-semibold">
          Suggested
        </h2>
        <span className="rounded-full bg-muted px-2 text-caption font-medium text-muted-foreground tabular-nums">
          <span aria-hidden="true">{proposals.length}</span>
          <span className="sr-only">
            {proposals.length} {proposals.length === 1 ? "suggestion" : "suggestions"}
          </span>
        </span>
        <span className="text-caption text-muted-foreground">
          None is used until you accept it. A rejected one isn't suggested again.
        </span>
      </div>
      <ul className="divide-y">
        {proposals.map((proposal) => (
          <Proposal key={proposal.id} proposal={proposal} scopes={scopes} actions={moving} />
        ))}
      </ul>
    </section>
  );
};
