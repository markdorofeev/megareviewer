import { CodeXmlIcon, type LucideIcon, NetworkIcon, RouteIcon } from "lucide-react";
import { KeyHint } from "../../review/index.ts";
import { Toggle } from "../../ui/toggle.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import type { Layout } from "./model.ts";

/**
 * The code, the overview, or the tour once there's one, at the start of the bar so it's in reach
 * wherever the reader is. Its words go below 1536px, where the bar needs the room, and stay its
 * accessible names.
 */
export const LayoutSwitch = ({
  layout,
  tour,
  onChange,
}: {
  readonly layout: Layout;
  /** There's a tour to switch to. */
  readonly tour: boolean;
  readonly onChange: (layout: Layout) => void;
}) => {
  const options: readonly { value: Layout; label: string; Icon: LucideIcon }[] = [
    { value: "map", label: "Code", Icon: CodeXmlIcon },
    { value: "overview", label: "Overview", Icon: NetworkIcon },
    ...(tour ? [{ value: "tour" as const, label: "Tour", Icon: RouteIcon }] : []),
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
            <span className="max-2xl:sr-only">{label}</span>
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
