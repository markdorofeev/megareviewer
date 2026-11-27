import { CodeXmlIcon, type LucideIcon, NetworkIcon, RouteIcon } from "lucide-react";
import { KeyHint } from "../../review/index.ts";
import { Toggle } from "../../ui/toggle.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import type { Layout } from "./model.ts";

/**
 * The code, the overview while it's on, or the tour once there's one, at the start of the bar so it's in reach
 * wherever the reader is. Its words go below 1280px, where the bar needs the room, and stay its
 * accessible names.
 */
export const LayoutSwitch = ({
  layout,
  overview,
  tour,
  onChange,
}: {
  readonly layout: Layout;
  /** The Display menu's Overview switch is on. */
  readonly overview: boolean;
  /** There's a tour to switch to. */
  readonly tour: boolean;
  readonly onChange: (layout: Layout) => void;
}) => {
  const options: readonly { value: Layout; label: string; Icon: LucideIcon }[] = [
    { value: "map", label: "Code", Icon: CodeXmlIcon },
    ...(overview ? [{ value: "overview" as const, label: "Overview", Icon: NetworkIcon }] : []),
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
