import { useRef } from "react";
import type { StatusResponse } from "../../../contracts/index.ts";
import { type ApiError, errorMessage } from "../api/index.ts";
import { usePageDisplayChoice } from "../lib/page-display.tsx";
import { type ThemePreference, useTheme } from "../lib/theme.ts";
import { cn } from "../lib/utils.ts";
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
import { Link } from "./Link.tsx";

interface Indicator {
  readonly tone: "ok" | "warning" | "danger" | "muted";
  readonly label: string;
  readonly detail: string;
}

export const statusIndicator = (
  status: StatusResponse | null,
  error: ApiError | null,
): Indicator => {
  if (error !== null) return { tone: "danger", label: "Disconnected", detail: errorMessage(error) };
  if (status === null) return { tone: "muted", label: "Connecting…", detail: "" };
  const version = `megareviewer ${status.version}`;
  const { github, bitbucket } = status.hosts;
  if (!github.configured && !bitbucket.configured) {
    return { tone: "warning", label: "Setup needed", detail: version };
  }
  const failing = [
    { name: "GitHub", error: github.error },
    { name: "Bitbucket", error: bitbucket.error },
  ].flatMap(({ name, error }) => (error === null ? [] : [{ name, error }]));
  if (failing.length > 0) {
    const names = failing.map(({ name }) => name).join(" and ");
    return {
      tone: "warning",
      label: failing.length === 1 ? `${names} problem` : `${names} problems`,
      detail: [...failing.map(({ name, error }) => `${name}: ${error}`), version].join("\n"),
    };
  }
  return { tone: "ok", label: "Ready", detail: version };
};

const TONE: Readonly<Record<Indicator["tone"], string>> = {
  ok: "bg-review-approved",
  warning: "bg-review-pending",
  danger: "bg-destructive",
  muted: "bg-muted-foreground",
};

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

export const Header = ({
  status,
  error,
}: {
  readonly status: StatusResponse | null;
  readonly error: ApiError | null;
}) => {
  const indicator = statusIndicator(status, error);
  return (
    <header className="flex h-12 items-center justify-between gap-4 border-b bg-surface-subtle px-4 sm:px-6">
      <Link to="/" className="text-heading font-semibold text-foreground hover:no-underline">
        megareviewer
      </Link>
      <div className="flex items-center gap-2">
        <span
          role="status"
          title={indicator.detail}
          className="flex items-center gap-2 text-muted-foreground"
        >
          <span aria-hidden="true" className={cn("size-2 rounded-full", TONE[indicator.tone])} />
          {indicator.label}
        </span>
        <DisplayMenu />
      </div>
    </header>
  );
};
