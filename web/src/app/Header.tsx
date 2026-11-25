import { SlidersHorizontalIcon } from "lucide-react";
import { useRef } from "react";
import { usePageDisplayChoice } from "../lib/page-display.tsx";
import { type ThemePreference, useTheme } from "../lib/theme.ts";
import { cn } from "../lib/utils.ts";
import { Button, buttonVariants } from "../ui/button.tsx";
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
import { matchRoute, PREFERENCES_PATH, usePathname } from "./router.ts";

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
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="max-sm:px-1.5" />}>
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
            {page.toggles !== undefined && (
              <>
                {page.toggles.map((toggle) => (
                  <DropdownMenuCheckboxItem
                    key={toggle.label}
                    checked={toggle.checked}
                    onCheckedChange={toggle.onChange}
                  >
                    {toggle.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            {page.more !== undefined && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{page.more.label}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={page.more.value}
                    onValueChange={page.more.onChange}
                  >
                    {page.more.options.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
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

/** To the preferences page, on every page; on a phone, its icon alone. */
export const PreferencesLink = ({ current }: { readonly current: boolean }) => (
  <Link
    to={PREFERENCES_PATH}
    aria-current={current ? "page" : undefined}
    className={cn(
      buttonVariants({ variant: "ghost", size: "sm" }),
      "min-w-7 text-foreground hover:no-underline aria-[current=page]:bg-muted max-sm:px-0",
    )}
  >
    <SlidersHorizontalIcon aria-hidden="true" className="sm:hidden" />
    <span className="max-sm:sr-only">Preferences</span>
  </Link>
);

export const Header = () => {
  const route = matchRoute(usePathname());
  return (
    <header className="flex h-12 items-center justify-between gap-4 border-b bg-background px-4 max-sm:gap-2 sm:px-6">
      <Link to="/" className="text-heading font-semibold text-foreground hover:no-underline">
        megareviewer
      </Link>
      <div className="flex items-center gap-2 max-sm:gap-1">
        <ConnectionsButton />
        <PreferencesLink current={route.page === "preferences"} />
        <DisplayMenu />
      </div>
    </header>
  );
};
