import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RepoRef } from "../../../../src/domain/review/index.ts";
import {
  COUNT_FROM,
  EMPTY_RULE,
  PreferenceForm,
  type RuleFields,
  tooLong,
} from "./PreferenceForm.tsx";
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
    const kinds = screen.getByRole("radiogroup", { name: "Kind" });
    expect(
      within(kinds).getByRole("radio", { name: "Look for" }).getAttribute("aria-checked"),
    ).toBe("true");
    await userEvent.click(within(kinds).getByRole("radio", { name: "Don't flag" }));
    expect(screen.getByLabelText("What an AI review should not flag")).toBe(field());
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

  it("counts the characters from 250 of 300, and over them says by how much and won't save", async () => {
    const { onSubmit } = renderForm();
    const count = () => document.querySelector("[data-slot=character-count]")?.textContent;
    expect(count()).toBeUndefined();
    fireEvent.change(field(), { target: { value: "x".repeat(COUNT_FROM - 1) } });
    expect(count()).toBeUndefined();
    expect(field().getAttribute("aria-describedby")).toBe(screen.getByRole("status").id);
    fireEvent.change(field(), { target: { value: "x".repeat(COUNT_FROM) } });
    expect(count()).toBe("250/300 characters");
    fireEvent.change(field(), { target: { value: "x".repeat(312) } });
    expect(count()).toBe("312/300 characters");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe(tooLong(12));
    expect(tooLong(12)).toBe(
      "12 characters over the limit. Keep it to one rule; add another preference for the rest.",
    );
    expect(tooLong(1)).toMatch(/^1 character over/);
    // Disabled, but still reachable, and it says why.
    expect(add().getAttribute("aria-disabled")).toBe("true");
    expect(add().hasAttribute("disabled")).toBe(false);
    expect(add().getAttribute("aria-describedby")).toBe(screen.getByRole("status").id);
    add().focus();
    expect(document.activeElement).toBe(add());
    await userEvent.click(add());
    await userEvent.type(field(), "{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    // What's wrong goes as soon as the text fits.
    fireEvent.change(field(), { target: { value: "x".repeat(300) } });
    expect(screen.getByRole("status").textContent).toBe("");
    expect(count()).toBe("300/300 characters");
    expect(add().getAttribute("aria-disabled")).not.toBe("true");
  });

  it("asks for the rule before saving an empty one, with the focus on it", async () => {
    const { onSubmit } = renderForm();
    await userEvent.click(add());
    expect(screen.getByRole("status").textContent).toBe(EMPTY_RULE);
    expect(document.activeElement).toBe(field());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears the text once it's saved, keeping the kind and the scope", async () => {
    const { onSubmit } = renderForm();
    await userEvent.click(screen.getByRole("radio", { name: "Don't flag" }));
    await userEvent.type(field(), "Naming{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(field().value).toBe("");
    expect(screen.getByRole("radio", { name: "Don't flag" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    await userEvent.type(field(), "Import order{Enter}");
    expect(onSubmit).toHaveBeenLastCalledWith({
      kind: "dont-flag",
      text: "Import order",
      scope: GLOBAL,
    });
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
    expect(within(form).queryByRole("radiogroup")).toBeNull();
    expect(form.querySelector("[data-slot=preference-kind]")?.textContent).toBe("Don't flag");
    expect(within(form).queryByRole("combobox")).toBeNull();
    expect(within(form).getByText("Everywhere")).toBeTruthy();
  });

  it("starts over the limit on a text too long, as a suggestion's can be, and cancels", async () => {
    const { onCancel } = renderForm({
      initial: { kind: "look-for", text: "x".repeat(310), scope: GLOBAL },
    });
    expect(screen.getByRole("status").textContent).toBe(tooLong(10));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("is one row inline, on its scope with no choice of it, labelled for screen readers", async () => {
    const { onSubmit } = renderForm({
      inline: true,
      initial: { kind: "look-for", text: "", scope: { kind: "repo", repo: shop } },
    });
    const form = screen.getByRole("form", { name: "Add a preference" });
    expect(within(form).queryByRole("combobox")).toBeNull();
    expect(within(form).queryByText("Applies to")).toBeNull();
    expect(screen.getByLabelText("What an AI review should look for")).toBe(field());
    expect(form.querySelector("label")?.className).toContain("sr-only");
    expect(field().getAttribute("placeholder")).toBe(
      "Tenant isolation: every query filters by tenant ID",
    );
    await userEvent.type(field(), "Money as floats{Enter}");
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "look-for",
      text: "Money as floats",
      scope: { kind: "repo", repo: shop },
    });
  });

  it("puts the caret after the text when it opens with the focus", () => {
    renderForm({ focus: true, initial: { kind: "dont-flag", text: "Naming", scope: GLOBAL } });
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(6);
  });
});
