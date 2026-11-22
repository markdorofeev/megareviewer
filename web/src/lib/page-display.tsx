import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** A switch a page puts in the Display menu under its choice, such as the review page's decisions. */
export interface PageToggle {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

/**
 * A choice of views a page puts in the header's Display menu, such as the review page's layout,
 * with the page's switches under it. The page owns the values; the menu shows them and reports the
 * reviewer's pick.
 */
export interface PageDisplay {
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly toggles?: readonly PageToggle[];
}

// Two contexts, so a page setting its choice doesn't re-render from its own update.
const ChoiceContext = createContext<PageDisplay | null>(null);
const SetterContext = createContext<(display: PageDisplay | null) => void>(() => {});

export const PageDisplayProvider = ({ children }: { readonly children: ReactNode }) => {
  const [display, setDisplay] = useState<PageDisplay | null>(null);
  return (
    <SetterContext.Provider value={setDisplay}>
      <ChoiceContext.Provider value={display}>{children}</ChoiceContext.Provider>
    </SetterContext.Provider>
  );
};

/** The current page's choice, for the Display menu. */
export const usePageDisplayChoice = (): PageDisplay | null => useContext(ChoiceContext);

/** Puts the page's choice in the Display menu while the page is mounted. */
export const usePageDisplay = (display: PageDisplay): void => {
  const set = useContext(SetterContext);
  const onChange = useRef(display.onChange);
  onChange.current = display.onChange;
  const onToggles = useRef((display.toggles ?? []).map((toggle) => toggle.onChange));
  onToggles.current = (display.toggles ?? []).map((toggle) => toggle.onChange);
  const { label, options, value } = display;
  // Strings, so the menu's switches change only when a label or a state does.
  const labels = (display.toggles ?? []).map((toggle) => toggle.label).join("\n");
  const checks = (display.toggles ?? []).map((toggle) => (toggle.checked ? "1" : "0")).join("");
  const shown = useMemo((): PageDisplay => {
    const toggles = (labels === "" ? [] : labels.split("\n")).map((label, at) => ({
      label,
      checked: checks[at] === "1",
      onChange: (next: boolean) => onToggles.current[at]?.(next),
    }));
    return {
      label,
      options,
      value,
      onChange: (next) => onChange.current(next),
      ...(toggles.length === 0 ? {} : { toggles }),
    };
  }, [label, options, value, labels, checks]);
  useEffect(() => set(shown), [set, shown]);
  useEffect(() => () => set(null), [set]);
};
