import { TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  MAX_PREFERENCE_TEXT,
  type PreferenceKind,
  type PreferenceScope,
} from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { Toggle } from "../../ui/toggle.tsx";
import { KIND, KindChip, type ScopeOption, scopeKey } from "./rule.tsx";

export interface RuleFields {
  readonly kind: PreferenceKind;
  readonly text: string;
  readonly scope: PreferenceScope;
}

export const EMPTY_RULE = "Write the rule first.";
export const tooLong = (over: number): string =>
  `A preference is one sentence of at most ${MAX_PREFERENCE_TEXT} characters: this is ${over} too many.`;

const KINDS: readonly PreferenceKind[] = ["look-for", "dont-flag"];

const ASKS: Readonly<Record<PreferenceKind, { readonly label: string; readonly example: string }>> =
  {
    "look-for": {
      label: "What an AI review should look for",
      example: "Tenant isolation: every query filters by tenant ID",
    },
    "dont-flag": { label: "What an AI review should leave out", example: "Naming" },
  };

/**
 * A preference being written: its kind, its one sentence, counted, and where it applies. Adding
 * one, editing one and accepting a proposal with changes are this form; saving a rule from a point
 * is too, with its kind fixed. `onSubmit` answers why it failed, or null.
 */
export const PreferenceForm = ({
  legend,
  initial,
  scopes,
  kindFixed = false,
  submit,
  submitting,
  note = null,
  focus = false,
  onSubmit,
  onCancel,
}: {
  /** The form's name: "Add a preference". */
  readonly legend: string;
  readonly initial: RuleFields;
  /** Where it can apply; the first is chosen when `initial.scope` isn't among them. */
  readonly scopes: readonly ScopeOption[];
  /** The kind is shown, not chosen, as on a rule saved from a point. */
  readonly kindFixed?: boolean;
  /** The submit button's words, and while it saves: "Add preference", "Adding…". */
  readonly submit: string;
  readonly submitting: string;
  /** Something to say before the first submit, such as why a proposal needs an edit. */
  readonly note?: string | null;
  /** The text takes the focus as the form opens, its caret after what's written. */
  readonly focus?: boolean;
  readonly onSubmit: (fields: RuleFields) => Promise<string | null>;
  /** Without it the form has no Cancel, as when it's all the page shows. */
  readonly onCancel?: () => void;
}) => {
  const id = useId();
  const [kind, setKind] = useState(initial.kind);
  const [text, setText] = useState(initial.text);
  const [scope, setScope] = useState(scopeKey(initial.scope));
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(note);
  const field = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only as the form opens.
  useEffect(() => {
    if (!focus || field.current === null) return;
    field.current.focus();
    field.current.setSelectionRange(field.current.value.length, field.current.value.length);
  }, []);
  const chosen = scopes.find((option) => option.key === scope) ?? scopes[0];
  const length = text.trim().length;
  const over = length - MAX_PREFERENCE_TEXT;

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || chosen === undefined) return;
    if (length === 0) return setProblem(EMPTY_RULE);
    if (over > 0) return setProblem(tooLong(over));
    setPending(true);
    setProblem(null);
    const failure = await onSubmit({ kind, text: text.trim(), scope: chosen.scope });
    setPending(false);
    setProblem(failure);
  };

  return (
    <form
      aria-label={legend}
      data-slot="preference-form"
      className="flex flex-col gap-2.5"
      onSubmit={(event) => void send(event)}
      noValidate
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {kindFixed ? (
          <KindChip kind={kind} />
        ) : (
          <fieldset className="flex items-center gap-1">
            <legend className="sr-only">Kind</legend>
            {KINDS.map((option) => {
              const { label, icon: Icon } = KIND[option];
              return (
                <Toggle
                  key={option}
                  variant="outline"
                  size="sm"
                  pressed={kind === option}
                  onPressedChange={(pressed) => {
                    if (pressed) setKind(option);
                  }}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </Toggle>
              );
            })}
          </fieldset>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <span id={`${id}-scope`} className="shrink-0 text-caption text-muted-foreground">
            Applies to
          </span>
          {scopes.length > 1 && chosen !== undefined ? (
            <Select
              value={chosen.key}
              items={scopes.map((option) => ({ value: option.key, label: option.label }))}
              onValueChange={(next) => {
                if (typeof next === "string") setScope(next);
              }}
            >
              <SelectTrigger size="sm" className="max-w-64 min-w-0" aria-labelledby={`${id}-scope`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="start">
                {scopes.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="truncate">{chosen?.label.toLowerCase()}</span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-text`} className="text-caption font-medium">
          {ASKS[kind].label}
        </label>
        <Textarea
          ref={field}
          id={`${id}-text`}
          rows={2}
          className="min-h-14 bg-card"
          placeholder={ASKS[kind].example}
          value={text}
          // One sentence: Enter saves it, and a pasted line break is a space.
          onChange={(event) => {
            setText(event.target.value.replace(/\s*\n\s*/g, " "));
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          aria-invalid={problem !== null || over > 0}
          aria-describedby={`${id}-count ${id}-problem`}
        />
        <div className="flex flex-wrap items-start justify-between gap-x-3 text-caption">
          <span id={`${id}-problem`} role="status" className="min-w-0 flex-1 text-destructive">
            {problem !== null && (
              <>
                <TriangleAlertIcon
                  aria-hidden="true"
                  className="mr-1 inline size-3.5 align-[-2px]"
                />
                {problem}
              </>
            )}
          </span>
          <span
            id={`${id}-count`}
            data-slot="character-count"
            className={cn(
              "tabular shrink-0",
              over > 0 ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {length}/{MAX_PREFERENCE_TEXT}
            <span className="sr-only"> characters</span>
            {over > 0 && `, ${over} too many`}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel !== undefined && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={pending}
          focusableWhenDisabled
          aria-busy={pending}
        >
          {pending ? submitting : submit}
        </Button>
      </div>
    </form>
  );
};
