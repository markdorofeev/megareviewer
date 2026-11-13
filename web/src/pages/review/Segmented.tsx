import { Toggle } from "../../ui/toggle.tsx";

/**
 * A choice of a few values as pressed buttons in a named group, such as the review's verdict.
 * Pressing the chosen one again keeps it.
 */
export const Segmented = <T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  readonly legend: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}) => (
  <fieldset className="flex items-center gap-1">
    <legend className="sr-only">{legend}</legend>
    {options.map((option) => (
      <Toggle
        key={option.value}
        variant="outline"
        size="sm"
        pressed={value === option.value}
        onPressedChange={(pressed) => {
          if (pressed) onChange(option.value);
        }}
      >
        {option.label}
      </Toggle>
    ))}
  </fieldset>
);
