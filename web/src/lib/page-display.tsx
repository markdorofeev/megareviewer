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
 * with the page's switch under it. The page owns the values; the menu shows them and reports the
 * reviewer's pick.
 */
export interface PageDisplay {
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly toggle?: PageToggle;
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
  const onToggle = useRef(display.toggle?.onChange);
  onToggle.current = display.toggle?.onChange;
  const { label, options, value } = display;
  const toggleLabel = display.toggle?.label;
  const checked = display.toggle?.checked ?? false;
  const shown = useMemo(
    (): PageDisplay => ({
      label,
      options,
      value,
      onChange: (next) => onChange.current(next),
      ...(toggleLabel === undefined
        ? {}
        : {
            toggle: {
              label: toggleLabel,
              checked,
              onChange: (next: boolean) => onToggle.current?.(next),
            },
          }),
    }),
    [label, options, value, toggleLabel, checked],
  );
  useEffect(() => set(shown), [set, shown]);
  useEffect(() => () => set(null), [set]);
};
