import { PlusIcon } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import type { Preference } from "../../../../src/domain/review/index.ts";
import { Button } from "../../ui/button.tsx";
import { PreferenceForm, type RuleFields } from "./PreferenceForm.tsx";
import { type PreferenceActions, PreferenceList } from "./PreferenceList.tsx";
import type { ScopeOption } from "./rule.tsx";

/**
 * One scope's card: everywhere, or a repository. Its preferences, the form that adds one, opened
 * on this scope, and under them whatever else the scope has, a repository's guideline files and
 * its import.
 */
export const ScopeSection = ({
  option,
  title,
  word,
  preferences,
  scopes,
  actions,
  addable = true,
  adding,
  onAdding,
  onAdd,
  empty,
  children,
}: {
  /** The scope the section is for, which its form starts on. */
  readonly option: ScopeOption;
  readonly title: ReactNode;
  /** Muted, after the count: when its preferences are used. */
  readonly word: string;
  readonly preferences: readonly Preference[];
  readonly scopes: readonly ScopeOption[];
  readonly actions: PreferenceActions;
  /** False where `empty` already holds the form. */
  readonly addable?: boolean;
  /** The form is open here. */
  readonly adding: boolean;
  readonly onAdding: (adding: boolean) => void;
  readonly onAdd: (fields: RuleFields) => Promise<string | null>;
  /** In place of the rows when the scope has none. */
  readonly empty: ReactNode;
  readonly children?: ReactNode;
}) => {
  const id = useId();
  const add = useRef<HTMLButtonElement>(null);
  const close = () => {
    onAdding(false);
    add.current?.focus();
  };
  return (
    <section
      aria-labelledby={id}
      data-slot="preference-scope"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2">
        <h2 id={id} className="flex min-w-0 items-center gap-2 text-heading font-semibold">
          {title}
        </h2>
        <span className="rounded-full bg-muted px-2 text-caption font-medium text-muted-foreground tabular-nums">
          <span aria-hidden="true">{preferences.length}</span>
          <span className="sr-only">
            {preferences.length} {preferences.length === 1 ? "preference" : "preferences"}
          </span>
        </span>
        {/* On a phone the word goes under the title, so the button keeps its line. */}
        <span className="min-w-0 text-caption text-muted-foreground max-sm:order-last max-sm:basis-full">
          {word}
        </span>
        {addable && (
          <Button
            ref={add}
            variant="outline"
            size="sm"
            className="ml-auto"
            aria-expanded={adding}
            aria-label={
              option.scope.kind === "repo" ? `Add preference for ${option.label}` : undefined
            }
            onClick={() => onAdding(!adding)}
          >
            <PlusIcon aria-hidden="true" />
            Add preference
          </Button>
        )}
      </div>
      {adding && (
        <div className="border-b bg-surface-subtle px-4 py-3">
          <PreferenceForm
            legend="Add a preference"
            initial={{ kind: "look-for", text: "", scope: option.scope }}
            scopes={scopes}
            submit="Add preference"
            submitting="Adding…"
            focus
            onCancel={close}
            onSubmit={async (fields) => {
              const failed = await onAdd(fields);
              if (failed === null) close();
              return failed;
            }}
          />
        </div>
      )}
      {preferences.length === 0 ? (
        empty
      ) : (
        <PreferenceList
          preferences={preferences}
          scopes={scopes}
          actions={actions}
          label={`Preferences for ${option.label.toLowerCase()}`}
        />
      )}
      {children}
    </section>
  );
};
