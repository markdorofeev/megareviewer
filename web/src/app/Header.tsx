import { useId } from "react";
import { usePageDisplayChoice } from "../lib/page-display.tsx";
import { type ThemePreference, useTheme } from "../lib/theme.ts";
import { Label } from "../ui/label.tsx";
import { Switch } from "../ui/switch.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";
import { ConnectionsButton } from "./ConnectionsButton.tsx";
import { Link } from "./Link.tsx";

const THEMES: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** One of a few options, all in sight, as a row of toggle buttons. */
const Choice = ({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-muted-foreground">{label}</span>
    <ToggleGroup
      aria-label={label}
      variant="outline"
      size="sm"
      spacing={0}
      value={[value]}
      onValueChange={(next) => {
        // Pressing the option in use again would leave none; the choice stays.
        const chosen = options.find((option) => option.value === next[0]);
        if (chosen !== undefined && chosen.value !== value) onChange(chosen.value);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  </div>
);

const SwitchRow = ({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) => {
  const id = useId();
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <Label id={labelId} htmlFor={id} className="font-normal text-muted-foreground">
        {label}
      </Label>
      {/* Named by its label in every browser, whatever element Base UI renders the switch as. */}
      <Switch id={id} aria-labelledby={labelId} checked={checked} onCheckedChange={onChange} />
    </div>
  );
};

/**
 * The page's own choice of view and switch, if it has them, then the theme and the diff palette.
 * `onViewPicked` runs after the page's view changes, which takes the focus.
 */
export const DisplaySettings = ({ onViewPicked }: { readonly onViewPicked?: () => void }) => {
  const { theme, diffPalette, setTheme, setDiffPalette } = useTheme();
  const page = usePageDisplayChoice();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-slot="display-settings"
      className="flex flex-col gap-2 border-t px-1 pt-2"
    >
      <h2 id={headingId} className="font-medium">
        Display
      </h2>
      {page !== null && (
        <>
          <Choice
            label={page.label}
            options={page.options}
            value={page.value}
            onChange={(value) => {
              page.onChange(value);
              onViewPicked?.();
            }}
          />
          {page.toggle !== undefined && (
            <SwitchRow
              label={page.toggle.label}
              checked={page.toggle.checked}
              onChange={page.toggle.onChange}
            />
          )}
        </>
      )}
      <Choice
        label="Theme"
        options={THEMES}
        value={theme}
        onChange={(value) => {
          const chosen = THEMES.find((option) => option.value === value);
          if (chosen !== undefined) setTheme(chosen.value);
        }}
      />
      <SwitchRow
        label="Color-blind safe diff"
        checked={diffPalette === "cb"}
        onChange={(checked) => setDiffPalette(checked ? "cb" : "default")}
      />
    </section>
  );
};

export const Header = () => (
  <header className="flex h-12 items-center justify-between gap-4 border-b bg-background px-4 sm:px-6">
    <Link to="/" className="text-heading font-semibold text-foreground hover:no-underline">
      megareviewer
    </Link>
    <ConnectionsButton>
      {(closeOnPick) => <DisplaySettings onViewPicked={closeOnPick} />}
    </ConnectionsButton>
  </header>
);
