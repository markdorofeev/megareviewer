import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fixtureAnalysisView } from "../../../dev/fixtures/index.ts";
import { FileFinder, findFiles } from "./FileFinder.tsx";

const files = fixtureAnalysisView.analysis.files;

describe("findFiles", () => {
  it("matches every typed word anywhere in the path, ignoring case, in path order", () => {
    expect(findFiles(files, "ROUTES ord").map((file) => file.path)).toEqual([
      "src/routes/orders.ts",
    ]);
    expect(findFiles(files, "").map((file) => file.path)).toEqual(
      files.map((file) => file.path).sort(),
    );
    expect(findFiles(files, "nothing-like-this")).toEqual([]);
  });
});

describe("FileFinder", () => {
  it("picks the first match on Enter, or the one clicked", async () => {
    const onPick = vi.fn();
    render(<FileFinder files={files} onPick={onPick} onClose={() => {}} />);
    await userEvent.keyboard("money{Enter}");
    expect(onPick).toHaveBeenLastCalledWith(files.find((file) => file.path === "src/lib/money.ts"));

    await userEvent.clear(screen.getByRole("searchbox", { name: "File path" }));
    await userEvent.click(screen.getByRole("button", { name: "package.json" }));
    expect(onPick).toHaveBeenLastCalledWith(files.find((file) => file.path === "package.json"));
  });

  it("says when nothing matches", async () => {
    render(<FileFinder files={files} onPick={() => {}} onClose={() => {}} />);
    await userEvent.keyboard("zzz");
    expect(screen.getByText("No changed file matches.")).toBeTruthy();
  });
});
