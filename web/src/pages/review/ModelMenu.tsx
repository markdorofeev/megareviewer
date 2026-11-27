import { ChevronDownIcon } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";
import type { ModelOption } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu.tsx";
import { Input } from "../../ui/input.tsx";
import { byProvider, type ModelChoice, matching, pinnedOf } from "./model-choice.ts";

const ModelItem = ({
  option,
  noteId,
}: {
  readonly option: ModelOption;
  readonly noteId: string;
}) => (
  <DropdownMenuRadioItem
    value={option.id}
    disabled={!option.available}
    aria-describedby={option.available ? undefined : noteId}
  >
    {option.modelName}
  </DropdownMenuRadioItem>
);

/**
 * The field's keys: an arrow moves to the option next to it, which the menu's own navigation
 * wouldn't (it counts from the top), Escape and Tab are the menu's, and the rest are typed rather
 * than taken by the menu's typeahead.
 */
const onFilterKey = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Escape" || event.key === "Tab") return;
  event.stopPropagation();
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const menu = event.currentTarget.closest('[role="menu"]');
  const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  const after = items.findIndex(
    (item) => event.currentTarget.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const next =
    event.key === "ArrowDown" ? items[after] : items[(after === -1 ? items.length : after) - 1];
  if (next === undefined) return;
  event.preventDefault();
  next.focus();
};

/**
 * One group of options: its label says what runs them and who pays, or why they can't run. A long
 * group shows the chosen option and the default, and the rest as the reviewer filters for them, so
 * a provider with dozens of models doesn't outgrow the window.
 */
const ModelGroup = ({
  first,
  options,
  separated,
  noteId,
  choice,
}: {
  readonly first: ModelOption;
  readonly options: readonly ModelOption[];
  readonly separated: boolean;
  readonly noteId: string;
  readonly choice: ModelChoice;
}) => {
  const [query, setQuery] = useState("");
  const pinned = pinnedOf(options, choice.chosen, choice.defaultId);
  const more = options.length - pinned.length;
  const matches = matching(options, pinned, query);
  return (
    <DropdownMenuGroup>
      {separated && <DropdownMenuSeparator />}
      <DropdownMenuLabel className="flex flex-col gap-0.5">
        <span className="text-foreground">{first.available ? first.via : first.providerName}</span>
        {!first.available && (
          <span id={noteId} className="font-normal">
            {first.reason}
          </span>
        )}
      </DropdownMenuLabel>
      {pinned.map((option) => (
        <ModelItem key={option.id} option={option} noteId={noteId} />
      ))}
      {more > 0 && (
        <div className="px-1.5 py-1">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onFilterKey}
            placeholder={`Filter ${more} more models`}
            aria-label={`Filter ${more} more models through ${first.via}`}
            className="h-7"
          />
        </div>
      )}
      {matches.map((option) => (
        <ModelItem key={option.id} option={option} noteId={noteId} />
      ))}
      {more > 0 && query.trim() !== "" && matches.length === 0 && (
        <p className="px-2 py-1.5 text-caption text-muted-foreground">No model matches</p>
      )}
    </DropdownMenuGroup>
  );
};

/**
 * The options, grouped by what runs them. A disabled option stays focusable and is described by its
 * group's reason.
 */
export const ModelMenu = ({
  choice,
  disabled,
  variant,
  size = "sm",
}: {
  readonly choice: ModelChoice;
  readonly disabled: boolean;
  /** The button's beside it, so the two read as one control. */
  readonly variant: "default" | "outline" | "ai" | "ai-strong" | "ai-quiet";
  readonly size?: "sm" | "default";
}) => {
  const id = useId();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={variant}
            size={size}
            data-slot="model-menu"
            disabled={disabled}
            aria-label={
              choice.chosen === null ? "Choose a model" : `Model: ${choice.chosen.modelName}`
            }
            className={cn(
              "rounded-l-none px-0",
              size === "sm" ? "w-6" : "w-7",
              // Its left border divides it from the button, which leaves its own right one out.
              variant === "default" && "border-l-primary-foreground/30",
              variant === "outline" && "border-l-0",
              variant.startsWith("ai") && "border-l-primary/30",
            )}
          />
        }
      >
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuRadioGroup
          value={choice.chosen?.id ?? null}
          onValueChange={(value: string) => choice.choose(value)}
        >
          {byProvider(choice.options).map(([first, options], group) => (
            <ModelGroup
              key={first.id}
              first={first}
              options={options}
              separated={group > 0}
              noteId={`${id}-${group}`}
              choice={choice}
            />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
