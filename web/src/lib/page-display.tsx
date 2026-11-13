import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * A choice of views a page puts in the header's Display menu, such as the review page's layout.
 * The page owns the value; the menu shows it and reports the reviewer's pick.
 */
export interface PageDisplay {
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
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
  const { label, options, value } = display;
  const shown = useMemo(
    (): PageDisplay => ({ label, options, value, onChange: (next) => onChange.current(next) }),
    [label, options, value],
  );
  useEffect(() => set(shown), [set, shown]);
  useEffect(() => () => set(null), [set]);
};
