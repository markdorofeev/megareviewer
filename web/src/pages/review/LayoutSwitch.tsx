import { CodeXmlIcon, type LucideIcon, NetworkIcon, RouteIcon } from "lucide-react";
import { KeyHint } from "../../review/index.ts";
import { Toggle } from "../../ui/toggle.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import type { Layout } from "./model.ts";

/**
 * The code or the overview, the tour's Understand when the tour is on, at the start of the bar so
 * it's in reach wherever the reader is. Its words go below 1280px, where the bar needs the room,
 * and stay its accessible names.
 */
export const LayoutSwitch = ({
  layout,
  tour,
  onChange,
}: {
  readonly layout: Layout;
  /** The second layout is Understand. */
  readonly tour: boolean;
  readonly onChange: (layout: Layout) => void;
}) => {
  const options: readonly { value: Layout; label: string; Icon: LucideIcon }[] = [
    { value: "map", label: "Code", Icon: CodeXmlIcon },
    tour
      ? { value: "overview", label: "Understand", Icon: RouteIcon }
      : { value: "overview", label: "Overview", Icon: NetworkIcon },
  ];
  return (
    <fieldset data-slot="layout-switch" className="flex shrink-0 items-center gap-1">
      <legend className="sr-only">Layout</legend>
      {options.map(({ value, label, Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger
            render={
              <Toggle
                variant="outline"
                size="sm"
                pressed={layout === value}
                onPressedChange={(pressed) => {
                  if (pressed) onChange(value);
                }}
              />
            }
          >
            <Icon aria-hidden="true" />
            <span className="max-xl:sr-only">{label}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            {label}
            <KeyHint id="toggleLayout" />
          </TooltipContent>
        </Tooltip>
      ))}
    </fieldset>
  );
};
