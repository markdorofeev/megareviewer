import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { Guardrail } from "../../../../src/domain/review/index.ts";
import { DraftGuardrail, guardrailSentence, kindPhrase } from "./Guardrail.tsx";

const ruff: Guardrail = { is: "rule", tool: "ruff", rule: "BLE001", configPath: "ruff.toml" };
const archUnit: Guardrail = {
  is: "suggested",
  kind: "architecture-rule",
  engine: "ArchUnit",
  does: "Services never import a controller.",
};

const DRAFT = "Swallows every error of the fetch";

/** A saved draft whose text the line can change, as the page's is. */
const Draft = ({ guardrail }: { readonly guardrail: Guardrail }) => {
  const [body, setBody] = useState(DRAFT);
  return (
    <>
      <p data-testid="body">{body}</p>
      <DraftGuardrail guardrail={guardrail} family="Claude" body={body} onEdit={setBody} />
    </>
  );
};

describe("guardrailSentence", () => {
  it("names a rule by its tool, and a suggested check by its kind, engine and what it asserts", () => {
    expect(guardrailSentence(ruff)).toBe("A check could catch this next time: `BLE001` in Ruff.");
    expect(guardrailSentence(archUnit)).toBe(
      "A check could catch this next time: an architecture rule in ArchUnit. Services never import a controller.",
    );
    expect(kindPhrase("lint-rule")).toBe("a lint rule");
  });
});

describe("DraftGuardrail", () => {
  it("adds the check's sentence to the draft once", async () => {
    const user = userEvent.setup();
    render(<Draft guardrail={ruff} />);
    await user.click(screen.getByRole("button", { name: "Add to comment" }));
    expect(screen.getByTestId("body").textContent).toBe(
      `${DRAFT}\n\nA check could catch this next time: \`BLE001\` in Ruff.`,
    );
    expect(screen.queryByRole("button", { name: "Add to comment" })).toBeNull();
    expect(screen.getByText("Added to the comment")).toBeTruthy();
  });

  it("adds a suggested check's kind, engine and what it asserts", async () => {
    const user = userEvent.setup();
    render(<Draft guardrail={archUnit} />);
    expect(document.querySelector("[data-slot=guardrail]")?.textContent).toContain(
      "Suggested by Claude, not checked.",
    );
    await user.click(screen.getByRole("button", { name: "Add to comment" }));
    expect(screen.getByTestId("body").textContent).toBe(
      `${DRAFT}\n\nA check could catch this next time: an architecture rule in ArchUnit. Services never import a controller.`,
    );
  });
});
