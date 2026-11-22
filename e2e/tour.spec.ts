import type { Page } from "@playwright/test";
import { expect, PR, TOKEN, test } from "./fake-server.ts";

const TITLE = "Add receipt download endpoint, with a tour";

/** Opens a PR from its link, waits for the code's analysis, then asks Claude and waits for it. */
const openReview = async (page: Page, url: string, title: string) => {
  await page.goto(`/?token=${TOKEN}`);
  await page.getByRole("textbox", { name: "Pull request link" }).fill(url);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page).toHaveURL(/\/review\/a_[0-9a-f]+$/);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Analysis progress" })).toBeHidden();
  await page.getByRole("button", { name: "Request AI review" }).click();
  await expect(page.locator("[data-slot=model-hairline]")).toHaveCount(0);
  await expect(page.locator("[data-landing]")).toHaveAttribute("data-landing", "done");
};

const layout = (page: Page) => page.locator("[data-slot=review-page]");

test("with the Tour switch off, a run asks for no tour and the layout is Overview", async ({
  page,
}) => {
  const run = page.waitForRequest((request) => /\/model$/.test(request.url()));
  await openReview(page, PR.receiptsTour, TITLE);
  expect((await run).postDataJSON()).not.toHaveProperty("tour");
  await expect(page.getByRole("button", { name: /^Tour · / })).toHaveCount(0);
  await page.getByRole("button", { name: "Display" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Tour (preview)" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.getByRole("menuitemradio", { name: "Overview" })).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`walks the tour and back to the code, in ${theme}`, async ({ page }) => {
    await page.addInitScript((chosen) => {
      window.localStorage.setItem("megareviewer:tour", "true");
      window.localStorage.setItem("megareviewer:theme", JSON.stringify(chosen));
    }, theme);
    const run = page.waitForRequest((request) => /\/model$/.test(request.url()));
    await openReview(page, PR.receiptsTour, TITLE);
    expect((await run).postDataJSON()).toMatchObject({ tour: true });

    // The brief's link opens the tour.
    await page.getByRole("button", { name: "Tour · 3 steps" }).click();
    await expect(layout(page)).toHaveAttribute("data-layout", "overview");
    const steps = page.getByRole("region", { name: "Tour steps" });
    await expect(steps.getByRole("heading", { level: 2 })).toHaveCount(4);

    // The changed lines the steps show and the ledger's add up to the pull request's.
    const shown = await steps
      .locator("[data-slot=tour-card]")
      .evaluateAll((cards) =>
        cards.reduce(
          (sum, card) => sum + Number(/· (\d+) of/.exec(card.textContent ?? "")?.[1] ?? 0),
          0,
        ),
      );
    const ledger = await steps.locator("[data-slot=tour-end] details li").evaluateAll((rows) =>
      rows.reduce((sum, row) => {
        const added = /\+(\d+)/.exec(row.textContent ?? "")?.[1] ?? "0";
        const removed = /−(\d+)/.exec(row.textContent ?? "")?.[1] ?? "0";
        return sum + Number(added) + Number(removed);
      }, 0),
    );
    const counted = await page.getByText(/^\d+ lines added, \d+ removed$/).textContent();
    const [added = NaN, removed = NaN] = (counted ?? "").match(/\d+/g)?.map(Number) ?? [];
    const total = added + removed;
    expect(shown + ledger).toBe(total);

    // A box goes to its step.
    await page.getByRole("button", { name: /^config\/, step 3/ }).click();
    await expect(page.locator(":focus")).toContainText("Step 3:");

    // A comment on a step's line is a draft of the review, which the map and Publish show.
    const first = steps.locator("[data-slot=tour-step]").first();
    const number = first.getByRole("button", { name: /^Comment on line \d+$/ }).first();
    const line = await number.textContent();
    await number.click();
    await first.getByRole("textbox", { name: `Comment on line ${line}` }).fill("Why here?");
    await first.getByRole("button", { name: "Add to review" }).click();

    // Open in code lands on the lines, and Esc comes back to the step.
    await steps.getByRole("button", { name: /^Open src\/services\/receipts\.ts lines/ }).click();
    await expect(layout(page)).toHaveAttribute("data-layout", "map");
    await expect(page.getByRole("button", { name: "Back to tour · Step 2" })).toBeVisible();
    await expect(page.locator("[data-slot=tour-landing]")).toContainText("Tour step 2");
    await expect(page.locator("[data-point-mark=step]").first()).toBeVisible();
    await expect(page.getByLabel("Changes").getByText("Why here?")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(layout(page)).toHaveAttribute("data-layout", "overview");
    await expect(page.locator(":focus")).toContainText("Step 2:");

    await page.getByRole("button", { name: /^Publish review…/ }).click();
    await expect(page.getByRole("dialog", { name: "Publish review" })).toContainText("Why here?");
  });
}
