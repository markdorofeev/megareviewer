import { useRef } from "react";
import { usePageDisplayChoice } from "../lib/page-display.tsx";
import { type ThemePreference, useTheme } from "../lib/theme.ts";
import { Button } from "../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { ConnectionsButton } from "./ConnectionsButton.tsx";
import { Link } from "./Link.tsx";

const THEMES: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** The page's own choice of view and switch, if it has them, then the theme and the diff palette. */
export const DisplayMenu = () => {
  const { theme, diffPalette, setTheme, setDiffPalette } = useTheme();
  const page = usePageDisplayChoice();
  // A view the page switches to takes the focus itself, so closing on it doesn't move it back.
  const pickedView = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
        Display
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        finalFocus={() => {
          const picked = pickedView.current;
          pickedView.current = false;
          return !picked;
        }}
      >
        {page !== null && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{page.label}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={page.value}
                onValueChange={(value) => {
                  pickedView.current = true;
                  page.onChange(value);
                }}
              >
                {page.options.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {page.toggle !== undefined && (
              <>
                <DropdownMenuCheckboxItem
                  checked={page.toggle.checked}
                  onCheckedChange={page.toggle.onChange}
                >
                  {page.toggle.label}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
              </>
            )}
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              const chosen = THEMES.find((option) => option.value === value);
              if (chosen !== undefined) setTheme(chosen.value);
            }}
          >
            {THEMES.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={diffPalette === "cb"}
          onCheckedChange={(checked) => setDiffPalette(checked ? "cb" : "default")}
        >
          Color-blind safe diff
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const Header = () => (
  <header className="flex h-12 items-center justify-between gap-4 border-b bg-background px-4 sm:px-6">
    <Link to="/" className="text-heading font-semibold text-foreground hover:no-underline">
      megareviewer
    </Link>
    <div className="flex items-center gap-2">
      <ConnectionsButton />
      <DisplayMenu />
    </div>
  </header>
);
