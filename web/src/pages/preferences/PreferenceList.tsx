import { PencilIcon, SparklesIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import type { Preference, PreferenceId } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { DANGER } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { Switch } from "../../ui/switch.tsx";
import { Dialog } from "../review/Dialog.tsx";
import { PreferenceForm, type RuleFields, useFocusBack } from "./PreferenceForm.tsx";
import { KindChip, type ScopeOption } from "./rule.tsx";

/** What a row can do; each answers why it failed, or null. */
export interface PreferenceActions {
  readonly onSwitch: (id: PreferenceId, enabled: boolean) => Promise<string | null>;
  readonly onEdit: (id: PreferenceId, fields: RuleFields) => Promise<string | null>;
  readonly onDelete: (id: PreferenceId) => Promise<string | null>;
}

const DeleteDialog = ({
  preference,
  onDelete,
  onClose,
}: {
  readonly preference: Preference;
  readonly onDelete: () => Promise<string | null>;
  readonly onClose: () => void;
}) => {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <Dialog title="Delete preference" onClose={onClose}>
      <p className="flex flex-wrap items-center gap-2">
        <KindChip kind={preference.kind} />
        <span className="min-w-0 break-words">{preference.text}</span>
      </p>
      <p className="text-ui text-muted-foreground">
        AI reviews stop using it. A review already made keeps what it says of it.
      </p>
      {failure !== null && (
        <p className={DANGER} role="alert">
          Couldn't delete it. {failure}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" data-autofocus onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const failed = await onDelete();
            setPending(false);
            setFailure(failed);
            if (failed === null) onClose();
          }}
        >
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Dialog>
  );
};

const Row = ({
  preference,
  scopes,
  actions,
}: {
  readonly preference: Preference;
  readonly scopes: readonly ScopeOption[];
  readonly actions: PreferenceActions;
}) => {
  const [mode, setMode] = useState<"shown" | "editing" | "deleting">("shown");
  const [failure, setFailure] = useState<string | null>(null);
  const edit = useFocusBack<HTMLButtonElement>(mode === "editing");
  const { id, kind, text, source, enabled } = preference;

  if (mode === "editing") {
    return (
      <li className="px-4 py-3">
        <PreferenceForm
          legend={`Edit: ${text}`}
          initial={preference}
          scopes={scopes}
          submit="Save"
          submitting="Saving…"
          focus
          onCancel={() => setMode("shown")}
          onSubmit={async (fields) => {
            const failed = await actions.onEdit(id, fields);
            if (failed === null) setMode("shown");
            return failed;
          }}
        />
      </li>
    );
  }
  return (
    <li
      data-slot="preference"
      data-enabled={enabled}
      className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5"
    >
      <KindChip kind={kind} className="min-w-[98px]" />
      <span
        className={cn(
          "min-w-0 flex-1 basis-56 text-body break-words",
          !enabled && "text-muted-foreground",
        )}
      >
        {text}
      </span>
      <span className="-my-[3px] ml-auto flex shrink-0 items-center gap-2">
        {source !== "written" && (
          <span className="flex items-center gap-1 text-caption text-muted-foreground">
            <SparklesIcon aria-hidden="true" className="size-3 text-primary" />
            From your reviews
          </span>
        )}
        {!enabled && <span className="text-caption text-muted-foreground">off</span>}
        <Switch
          checked={enabled}
          aria-label={`Use in AI reviews: ${text}`}
          onCheckedChange={async (checked) => {
            setFailure(null);
            setFailure(await actions.onSwitch(id, checked));
          }}
        />
        <span className="flex gap-0.5">
          <Button
            ref={edit}
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Edit: ${text}`}
            onClick={() => setMode("editing")}
          >
            <PencilIcon aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Delete: ${text}`}
            onClick={() => setMode("deleting")}
          >
            <Trash2Icon aria-hidden="true" className="size-3.5" />
          </Button>
        </span>
      </span>
      {failure !== null && (
        <p role="alert" className="basis-full text-caption text-destructive">
          <TriangleAlertIcon aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
          {failure}
        </p>
      )}
      {mode === "deleting" && (
        <DeleteDialog
          preference={preference}
          onDelete={() => actions.onDelete(id)}
          onClose={() => setMode("shown")}
        />
      )}
    </li>
  );
};

/**
 * A scope's preferences, each with its kind, its text, whether it came from the reviewer's
 * reviews, its switch, and Edit and Delete.
 */
export const PreferenceList = ({
  preferences,
  scopes,
  actions,
  label,
}: {
  readonly preferences: readonly Preference[];
  readonly scopes: readonly ScopeOption[];
  readonly actions: PreferenceActions;
  readonly label: string;
}) => (
  <ul aria-label={label} className="divide-y overflow-hidden rounded-lg border bg-card">
    {preferences.map((preference) => (
      <Row key={preference.id} preference={preference} scopes={scopes} actions={actions} />
    ))}
  </ul>
);
