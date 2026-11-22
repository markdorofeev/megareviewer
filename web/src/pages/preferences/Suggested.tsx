import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import {
  MAX_PREFERENCE_TEXT,
  type PreferenceProposal,
  type ProposalId,
} from "../../../../src/domain/review/index.ts";
import { Button } from "../../ui/button.tsx";
import { PreferenceForm, type RuleFields } from "./PreferenceForm.tsx";
import { KindChip, type ScopeOption } from "./rule.tsx";

/** What the reviewer decides on a proposal; each answers why it failed, or null. */
export interface ProposalActions {
  /** Adds it as it reads, or as the reviewer cut it to fit. */
  readonly onAccept: (id: ProposalId, changes: RuleFields | null) => Promise<string | null>;
  readonly onReject: (id: ProposalId) => Promise<string | null>;
}

const Proposal = ({
  proposal,
  scopes,
  actions,
}: {
  readonly proposal: PreferenceProposal;
  readonly scopes: readonly ScopeOption[];
  readonly actions: ProposalActions;
}) => {
  const { id, kind, text, evidence } = proposal;
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<"accept" | "reject" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const decide = async (decision: "accept" | "reject") => {
    if (pending !== null) return;
    // A proposal's text is the model's, and can be longer than a preference's.
    if (decision === "accept" && text.length > MAX_PREFERENCE_TEXT) return setEditing(true);
    setPending(decision);
    setFailure(null);
    const failed = await (decision === "accept"
      ? actions.onAccept(id, null)
      : actions.onReject(id));
    setPending(null);
    setFailure(failed);
  };

  if (editing) {
    return (
      <li className="bg-card px-4 py-3">
        <PreferenceForm
          legend={`Cut the suggestion to fit: ${text}`}
          initial={proposal}
          scopes={scopes}
          submit="Add"
          submitting="Adding…"
          submitIcon={<CheckIcon aria-hidden="true" />}
          focus
          onCancel={() => setEditing(false)}
          onSubmit={(fields) => actions.onAccept(id, fields)}
        />
      </li>
    );
  }
  return (
    <li data-slot="proposal" className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-2.5">
      <KindChip kind={kind} className="min-w-[98px]" />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-body break-words">{text}</p>
        {evidence.length > 0 && (
          <ul aria-label="Based on" className="flex flex-col text-caption text-muted-foreground">
            {[...new Set(evidence)].map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          variant="ai-quiet"
          size="sm"
          aria-label={`Add suggestion: ${text}`}
          aria-busy={pending === "accept"}
          onClick={() => void decide("accept")}
        >
          <CheckIcon aria-hidden="true" />
          {pending === "accept" ? "Adding…" : "Add"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          aria-label={`Dismiss suggestion: ${text}`}
          aria-busy={pending === "reject"}
          onClick={() => void decide("reject")}
        >
          {pending === "reject" ? "Dismissing…" : "Dismiss"}
        </Button>
      </div>
      {failure !== null && (
        <p role="alert" className="basis-full text-caption text-destructive">
          <TriangleAlertIcon aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
          {failure}
        </p>
      )}
    </li>
  );
};

/**
 * Proposals waiting for the reviewer, in the AI's tint. Add makes one a preference as it reads,
 * or opens it in the form when it's too long to; Dismiss rejects it for good. A decided one leaves
 * with the button that had the focus, so the list takes it, or `fallbackFocus` after the last.
 */
export const SuggestionList = ({
  proposals,
  scopes,
  actions,
  label,
  fallbackFocus,
}: {
  readonly proposals: readonly PreferenceProposal[];
  readonly scopes: readonly ScopeOption[];
  readonly actions: ProposalActions;
  readonly label: string;
  readonly fallbackFocus: RefObject<HTMLElement | null>;
}) => {
  const list = useRef<HTMLUListElement>(null);
  const moveFocus = () => (proposals.length > 1 ? list.current : fallbackFocus.current)?.focus();
  const decided = (decide: Promise<string | null>) =>
    decide.then((failed) => {
      if (failed === null) moveFocus();
      return failed;
    });
  const moving: ProposalActions = {
    onAccept: (proposalId, changes) => decided(actions.onAccept(proposalId, changes)),
    onReject: (proposalId) => decided(actions.onReject(proposalId)),
  };
  return (
    <ul
      ref={list}
      tabIndex={-1}
      aria-label={label}
      data-slot="suggestions"
      className="divide-y divide-ai-soft-bd overflow-hidden rounded-lg border border-ai-soft-bd bg-ai-soft"
    >
      {proposals.map((proposal) => (
        <Proposal key={proposal.id} proposal={proposal} scopes={scopes} actions={moving} />
      ))}
    </ul>
  );
};
