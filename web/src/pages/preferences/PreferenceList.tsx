import { EllipsisIcon, PencilIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import type { Preference, PreferenceId } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { DANGER } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu.tsx";
import { Switch } from "../../ui/switch.tsx";
import { Dialog } from "../review/Dialog.tsx";
import { PreferenceForm, type RuleFields, useFocusBack } from "./PreferenceForm.tsx";
import { KindChip, type ScopeOption, SOURCE } from "./rule.tsx";

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
  const more = useFocusBack<HTMLButtonElement>(mode === "editing");
  const { id, kind, text, source, enabled } = preference;

  if (mode === "editing") {
    return (
      <li className="bg-surface-subtle px-4 py-3">
        <PreferenceForm
          legend={`Edit: ${text}`}
          initial={preference}
          scopes={scopes}
          submit="Save"
          submitting="Saving…"
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
      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
    >
      <KindChip kind={kind} />
      <span
        className={cn("min-w-0 flex-1 basis-56 break-words", !enabled && "text-muted-foreground")}
      >
        {text}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="text-caption text-muted-foreground">
          {SOURCE[source]}
          {!enabled && " · off"}
        </span>
        <Switch
          checked={enabled}
          aria-label={`Use in AI reviews: ${text}`}
          onCheckedChange={async (checked) => {
            setFailure(null);
            setFailure(await actions.onSwitch(id, checked));
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button ref={more} variant="ghost" size="icon-xs" aria-label={`More for: ${text}`} />
            }
          >
            <EllipsisIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={() => setMode("editing")}>
              <PencilIcon aria-hidden="true" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setMode("deleting")}>
              <Trash2Icon aria-hidden="true" />
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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

/** A scope's preferences, each with its kind, its text, where it came from and its switch. */
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
  <ul aria-label={label} className="divide-y">
    {preferences.map((preference) => (
      <Row key={preference.id} preference={preference} scopes={scopes} actions={actions} />
    ))}
  </ul>
);
