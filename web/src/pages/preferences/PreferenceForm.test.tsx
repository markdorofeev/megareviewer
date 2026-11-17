import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RepoRef } from "../../../../src/domain/review/index.ts";
import { EMPTY_RULE, PreferenceForm, type RuleFields } from "./PreferenceForm.tsx";
import { GLOBAL, scopeOptions } from "./rule.tsx";

const shop: RepoRef = { host: "github", owner: "acme", repo: "shop" };
const scopes = scopeOptions([shop]);

const renderForm = (
  props: Partial<Parameters<typeof PreferenceForm>[0]> = {},
  answer: string | null = null,
) => {
  const onSubmit = vi.fn(async (_: RuleFields) => answer);
  const onCancel = vi.fn();
  render(
    <PreferenceForm
      legend="Add a preference"
      initial={{ kind: "look-for", text: "", scope: GLOBAL }}
      scopes={scopes}
      submit="Add preference"
      submitting="Adding…"
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onSubmit, onCancel };
};

const field = () => screen.getByRole<HTMLTextAreaElement>("textbox");
const add = () => screen.getByRole("button", { name: /^Add/ });

describe("PreferenceForm", () => {
  it("saves the kind, the trimmed text and the scope the reviewer chose", async () => {
    const { onSubmit } = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Don't flag" }));
    expect(screen.getByLabelText("What an AI review should leave out")).toBe(field());
    await userEvent.type(field(), "  Naming ");
    await userEvent.click(screen.getByRole("combobox", { name: "Applies to" }));
    await userEvent.click(await screen.findByRole("option", { name: "acme/shop" }));
    await userEvent.click(add());
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "dont-flag",
      text: "Naming",
      scope: { kind: "repo", repo: shop },
    });
  });

  it("counts the characters of 300, and says how many are too many instead of saving", async () => {
    const { onSubmit } = renderForm();
    const count = () => document.querySelector("[data-slot=character-count]")?.textContent;
    expect(count()).toBe("0/300 characters");
    fireEvent.change(field(), { target: { value: "x".repeat(312) } });
    expect(count()).toBe("312/300 characters, 12 too many");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    await userEvent.click(add());
    expect(screen.getByRole("status").textContent).toContain("this is 12 too many");
    expect(onSubmit).not.toHaveBeenCalled();
    // What's wrong goes as soon as the text changes.
    fireEvent.change(field(), { target: { value: "x".repeat(300) } });
    expect(screen.getByRole("status").textContent).toBe("");
    expect(count()).toBe("300/300 characters");
  });

  it("asks for the rule before saving an empty one", async () => {
    const { onSubmit } = renderForm();
    await userEvent.click(add());
    expect(screen.getByRole("status").textContent).toBe(EMPTY_RULE);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("saves on Enter, and keeps the rule one line", async () => {
    const { onSubmit } = renderForm();
    fireEvent.change(field(), { target: { value: "Naming\n of locals" } });
    expect(field().value).toBe("Naming of locals");
    await userEvent.type(field(), "{Enter}");
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "look-for",
      text: "Naming of locals",
      scope: GLOBAL,
    });
  });

  it("says it's saving, then why it failed, keeping what was written", async () => {
    let finish: (failure: string | null) => void = () => {};
    const onSubmit = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        }),
    );
    renderForm({ onSubmit, initial: { kind: "dont-flag", text: "Naming", scope: GLOBAL } });
    await userEvent.click(add());
    const saving = screen.getByRole("button", { name: "Adding…" });
    expect(saving.getAttribute("aria-busy")).toBe("true");
    // A second click while it saves doesn't save twice.
    await userEvent.click(saving);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    finish("50 preferences are already enabled for every repository.");
    expect(await screen.findByText(/50 preferences are already enabled/)).toBeTruthy();
    expect(field().value).toBe("Naming");
    expect(add().getAttribute("aria-busy")).toBe("false");
  });

  it("shows a fixed kind as a chip, and a lone scope in words", () => {
    renderForm({
      kindFixed: true,
      initial: { kind: "dont-flag", text: "Naming", scope: GLOBAL },
      scopes: scopeOptions([]),
    });
    const form = screen.getByRole("form", { name: "Add a preference" });
    expect(within(form).queryByRole("button", { name: "Look for" })).toBeNull();
    expect(form.querySelector("[data-slot=preference-kind]")?.textContent).toBe("Don't flag");
    expect(within(form).queryByRole("combobox")).toBeNull();
    expect(within(form).getByText("everywhere")).toBeTruthy();
  });

  it("starts on a note, such as why a suggestion needs an edit, and cancels", async () => {
    const { onCancel } = renderForm({ note: "Shorten it first." });
    expect(screen.getByRole("status").textContent).toBe("Shorten it first.");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("puts the caret after the text when it opens with the focus", () => {
    renderForm({ focus: true, initial: { kind: "dont-flag", text: "Naming", scope: GLOBAL } });
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(6);
  });
});
