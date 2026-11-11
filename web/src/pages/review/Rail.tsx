import type { ReactNode } from "react";
import { Segmented } from "./Segmented.tsx";

/** What the rail beside the code shows: the tree of files, or a miniature of the overview. */
export type RailForm = "tree" | "overview";

export const parseRailForm = (stored: unknown): RailForm | undefined =>
  stored === "tree" || stored === "overview" ? stored : undefined;

const FORMS: readonly { readonly value: RailForm; readonly label: string }[] = [
  { value: "tree", label: "Tree" },
  { value: "overview", label: "Overview" },
];

/**
 * The rail beside the code, with a switch between its two forms at the top. The two are an
 * experiment: the tree shows every file but not how directories connect, the miniature the reverse.
 */
export const Rail = ({
  form,
  onForm,
  children,
}: {
  readonly form: RailForm;
  readonly onForm: (form: RailForm) => void;
  readonly children: ReactNode;
}) => (
  <aside
    id="review-tree-rail"
    data-form={form}
    aria-label="Files"
    className="sticky top-0 flex max-h-screen min-h-0 flex-col gap-2 self-start overflow-hidden py-1 pr-1"
  >
    <Segmented legend="Show the files as" options={FORMS} value={form} onChange={onForm} />
    {children}
  </aside>
);
