import { CircleAlertIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  MAX_PREFERENCE_TEXT,
  type PreferenceKind,
  type PreferenceScope,
} from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { RadioGroup, RadioGroupSegment } from "../../ui/radio-group.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { KIND, KindChip, ScopeIcon, type ScopeOption, scopeKey } from "./rule.tsx";

export interface RuleFields {
  readonly kind: PreferenceKind;
  readonly text: string;
  readonly scope: PreferenceScope;
}

/** A ref for what opened the form in its place, which takes the focus back once the form closes. */
export const useFocusBack = <T extends HTMLElement>(open: boolean) => {
  const opener = useRef<T>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      opener.current?.focus();
    }
  }, [open]);
  return opener;
};

export const EMPTY_RULE = "Write the rule first.";
export const tooLong = (over: number): string =>
  `${over} ${over === 1 ? "character" : "characters"} over the limit. Keep it to one rule; add another preference for the rest.`;

const KINDS: readonly PreferenceKind[] = ["look-for", "dont-flag"];

const ASKS: Readonly<Record<PreferenceKind, { readonly label: string; readonly example: string }>> =
  {
    "look-for": {
      label: "What an AI review should look for",
      example: "Tenant isolation: every query filters by tenant ID",
    },
    "dont-flag": { label: "What an AI review should not flag", example: "Naming" },
  };

const ScopeLabel = ({ option }: { readonly option: ScopeOption }) => (
  <span className="flex min-w-0 items-center gap-2">
    <ScopeIcon scope={option.scope} className="size-3.5 text-muted-foreground" />
    <span className="truncate">{option.label}</span>
  </span>
);

/** From here the count shows, so a rule nearing its limit says so before it's over. */
export const COUNT_FROM = 250;

/**
 * A preference being written: its kind, its one sentence and where it applies. Adding one, editing
 * one and accepting a proposal too long to accept as it reads are this form; saving a rule from a
 * point is too, with its kind fixed. Inline, it's one row, the kind, the rule and the button, on
 * its initial scope with no choice of it, as a panel's always-open form is. The count shows from
 * 250 characters; over the limit it says by how much and won't save. `onSubmit` answers why it
 * failed, or null, and the text clears once it's saved.
 */
export const PreferenceForm = ({
  legend,
  initial,
  scopes,
  kindFixed = false,
  inline = false,
  submit,
  submitting,
  submitIcon,
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
  /** One row, its label for screen readers only, always on `initial.scope`. */
  readonly inline?: boolean;
  /** The submit button's words, and while it saves: "Add preference", "Adding…". */
  readonly submit: string;
  readonly submitting: string;
  readonly submitIcon?: ReactNode;
  /** The text takes the focus as the form opens, its caret after what's written. */
  readonly focus?: boolean;
  readonly onSubmit: (fields: RuleFields) => Promise<string | null>;
  /** Without it the form has no Cancel, as when it's always open. */
  readonly onCancel?: () => void;
}) => {
  const id = useId();
  const [kind, setKind] = useState(initial.kind);
  const [text, setText] = useState(initial.text);
  const [scope, setScope] = useState(scopeKey(initial.scope));
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only as the form opens.
  useEffect(() => {
    if (!focus || field.current === null) return;
    field.current.focus();
    field.current.setSelectionRange(field.current.value.length, field.current.value.length);
  }, []);
  const chosen = inline
    ? { key: scopeKey(initial.scope), label: "", scope: initial.scope }
    : (scopes.find((option) => option.key === scope) ?? scopes[0]);
  const length = text.trim().length;
  const over = length - MAX_PREFERENCE_TEXT;
  const message = problem ?? (over > 0 ? tooLong(over) : null);
  const counted = length >= COUNT_FROM;

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || chosen === undefined || over > 0) return;
    if (length === 0) {
      setProblem(EMPTY_RULE);
      field.current?.focus();
      return;
    }
    setPending(true);
    setProblem(null);
    const failure = await onSubmit({ kind, text: text.trim(), scope: chosen.scope });
    setPending(false);
    setProblem(failure);
    if (failure === null) setText("");
  };

  const kindControl = kindFixed ? (
    <KindChip kind={kind} />
  ) : (
    <RadioGroup
      aria-label="Kind"
      value={kind}
      onValueChange={(next) => {
        if (next === "look-for" || next === "dont-flag") setKind(next);
      }}
      className="inline-flex w-auto shrink-0 gap-0.5 rounded-md border border-input p-px"
    >
      {KINDS.map((option) => {
        const { label, icon: Icon } = KIND[option];
        return (
          <RadioGroupSegment key={option} value={option}>
            <Icon aria-hidden="true" />
            {label}
          </RadioGroupSegment>
        );
      })}
    </RadioGroup>
  );

  const label = (
    <label htmlFor={`${id}-text`} className={inline ? "sr-only" : "text-ui font-medium"}>
      {ASKS[kind].label}
    </label>
  );
  const textField = (
    <Textarea
      ref={field}
      id={`${id}-text`}
      rows={1}
      className={cn(
        "resize-none bg-card text-body aria-invalid:focus-visible:outline-destructive",
        inline ? "min-h-8 min-w-0 flex-1 basis-60 py-1" : "min-h-[72px]",
      )}
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
      aria-invalid={message !== null}
      aria-describedby={counted ? `${id}-count ${id}-problem` : `${id}-problem`}
    />
  );
  const said = (
    <p
      id={`${id}-problem`}
      role="status"
      className="flex min-w-0 flex-1 basis-60 items-start gap-1.5 text-caption text-destructive"
    >
      {message !== null && (
        <>
          <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {message}
        </>
      )}
    </p>
  );
  const count = counted && (
    <span
      id={`${id}-count`}
      data-slot="character-count"
      className={cn(
        "tabular shrink-0 text-caption",
        over > 0 ? "font-medium text-destructive" : "text-muted-foreground",
      )}
    >
      {length}/{MAX_PREFERENCE_TEXT}
      <span className="sr-only"> characters</span>
    </span>
  );
  const buttons = (
    <>
      {onCancel !== undefined && (
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
      <Button
        type="submit"
        className="shrink-0"
        disabled={pending || over > 0}
        focusableWhenDisabled
        aria-busy={pending}
        aria-describedby={over > 0 ? `${id}-problem` : undefined}
      >
        {submitIcon}
        {pending ? submitting : submit}
      </Button>
    </>
  );

  return (
    <form
      aria-label={legend}
      data-slot="preference-form"
      className={cn("flex flex-col", !inline && "gap-3")}
      onSubmit={(event) => void send(event)}
      noValidate
    >
      {inline ? (
        <>
          <div className="flex flex-wrap items-start gap-2">
            {kindControl}
            {label}
            {textField}
            {buttons}
          </div>
          {/* The status line stays when it's empty, so what it says next is announced. */}
          <div
            className={cn(
              "flex items-start justify-end gap-3",
              (message !== null || counted) && "mt-1.5",
            )}
          >
            {said}
            {count}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {kindControl}
            <div className="flex min-w-0 items-center gap-2">
              <span id={`${id}-scope`} className="shrink-0 text-ui text-muted-foreground">
                Applies to
              </span>
              {chosen === undefined ? null : scopes.length > 1 ? (
                <Select
                  value={chosen.key}
                  items={scopes.map((option) => ({ value: option.key, label: option.label }))}
                  onValueChange={(next) => {
                    if (typeof next === "string") setScope(next);
                  }}
                >
                  <SelectTrigger className="max-w-80 min-w-0" aria-labelledby={`${id}-scope`}>
                    <SelectValue>{() => <ScopeLabel option={chosen} />}</SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    {scopes.map((option) => (
                      <SelectItem key={option.key} value={option.key} label={option.label}>
                        <ScopeLabel option={option} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <ScopeLabel option={chosen} />
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {label}
            {textField}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            {said}
            {count}
            {buttons}
          </div>
        </>
      )}
    </form>
  );
};
