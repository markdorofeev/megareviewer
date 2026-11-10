import type { ReactNode } from "react";

/** What the rail beside the code shows: the tree of files, or a miniature of the overview. */
export type RailForm = "tree" | "overview";

export const parseRailForm = (stored: unknown): RailForm | undefined =>
  stored === "tree" || stored === "overview" ? stored : undefined;

const FORMS: readonly { readonly form: RailForm; readonly name: string }[] = [
  { form: "tree", name: "Tree" },
  { form: "overview", name: "Overview" },
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
  <aside id="review-tree-rail" className={`tree-rail form-${form}`} aria-label="Files">
    <fieldset className="layout-toggle rail-switch">
      <legend className="visually-hidden">Show the files as</legend>
      {FORMS.map((one) => (
        <button
          key={one.form}
          type="button"
          className="button"
          aria-pressed={form === one.form}
          onClick={() => onForm(one.form)}
        >
          {one.name}
        </button>
      ))}
    </fieldset>
    {children}
  </aside>
);
