import { describe, expect, it } from "vitest";
import { cn } from "./utils.ts";

describe("cn", () => {
  it("keeps a type-scale size beside a token color", () => {
    expect(cn("text-ui", "text-foreground")).toBe("text-ui text-foreground");
    expect(cn("text-code-compact text-diff-add-fg")).toBe("text-code-compact text-diff-add-fg");
  });

  it("lets a later utility replace an earlier one", () => {
    expect(cn("text-ui", "text-caption")).toBe("text-caption");
    expect(cn("bg-background", false, "bg-muted")).toBe("bg-muted");
    expect(cn("text-muted-foreground", "text-foreground")).toBe("text-foreground");
  });
});
