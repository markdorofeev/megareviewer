import type { Page } from "@playwright/test";
import { expect, PR, TOKEN, test } from "./fake-server.ts";

const TITLE = "Add receipt download endpoint, with a tour";

/** Opens a PR from its link, waits for the code's analysis, then asks Claude and waits for it. */
const openReview = async (page: Page, url: string, title: string) => {
  await page.goto(`/?token=${TOKEN}`);
  await page.getByRole("textbox", { name: "Pull request link" }).fill(url);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page).toHaveURL(/\/review\/a_[0-9a-f]+(\?view=\w+)?$/);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Analysis progress" })).toBeHidden();
  await page.getByRole("button", { name: "Request AI review" }).click();
  await expect(page.locator("[data-slot=model-hairline]")).toHaveCount(0);
  await expect(page.locator("[data-landing]")).toHaveAttribute("data-landing", "done");
};

const layout = (page: Page) => page.locator("[data-slot=review-page]");

test("with the Tour switch off, a run asks for no tour and there's no Tour layout", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("megareviewer:tour", "false");
    // The data-flow overview, the default, is written by the same pass, so a run would ask for it.
    window.localStorage.setItem("megareviewer:overview-form", JSON.stringify("directories"));
  });
  const run = page.waitForRequest((request) => /\/model$/.test(request.url()));
  await openReview(page, PR.receiptsTour, TITLE);
  expect((await run).postDataJSON()).not.toHaveProperty("tour");
  await expect(page.getByRole("button", { name: /^Tour · / })).toHaveCount(0);
  await page.getByRole("button", { name: "Display" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Tour (preview)" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  const layouts = page.getByRole("group", { name: "Layout" });
  await expect(layouts.getByRole("button", { name: "Overview" })).toBeVisible();
  await expect(layouts.getByRole("button", { name: "Tour" })).toHaveCount(0);
});

test("scrolling the tour moves its steps by what was scrolled, under a compact strip", async ({
  page,
}) => {
  await openReview(page, PR.receiptsTour, TITLE);
  await page.getByRole("button", { name: "Tour · 3 steps" }).click();
  await expect(page.locator("[data-slot=tour-step]").first()).toBeVisible();

  // One strip that shrank as it stuck under the bar threw the steps forward by the difference.
  const moved = await page.evaluate(async () => {
    const step = document.querySelector("[data-slot=tour-step]");
    if (step === null) return null;
    const settled = () =>
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))));
    window.scrollTo(0, 0);
    await settled();
    const from = step.getBoundingClientRect().top;
    for (let scroll = 0; scroll < 8; scroll += 1) {
      window.scrollBy(0, 60);
      await settled();
    }
    return { steps: from - step.getBoundingClientRect().top, window: window.scrollY };
  });
  expect(moved?.window).toBeGreaterThan(300);
  expect(Math.abs((moved?.steps ?? 0) - (moved?.window ?? Number.NaN))).toBeLessThan(1);

  // The path is still in reach, on one line under the bar, and goes to a step.
  const compact = page.locator("[data-slot=tour-strip-compact]");
  await expect(compact.locator("[data-slot=tour-box]").first()).toBeVisible();
  await compact.locator("[data-slot=tour-box]").last().click();
  await expect(page.locator(":focus")).toContainText("Step 3:");
});

for (const theme of ["light", "dark"] as const) {
  test(`walks the tour and back to the code, in ${theme}`, async ({ page }) => {
    await page.addInitScript((chosen) => {
      window.localStorage.setItem("megareviewer:theme", JSON.stringify(chosen));
    }, theme);
    const run = page.waitForRequest((request) => /\/model$/.test(request.url()));
    await openReview(page, PR.receiptsTour, TITLE);
    expect((await run).postDataJSON()).toMatchObject({ tour: true });

    // The brief's link opens the tour.
    await page.getByRole("button", { name: "Tour · 3 steps" }).click();
    await expect(layout(page)).toHaveAttribute("data-layout", "tour");
    const steps = page.getByRole("region", { name: "Tour steps" });
    await expect(steps.getByRole("heading", { level: 2, name: /^Step \d/ })).toHaveCount(3);
    await expect(
      steps.getByRole("region", { name: "After the tour" }).getByRole("heading", { level: 2 }),
    ).toHaveText([/^Not in the tour/, "Findings outside the steps"]);

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
    await expect(page.locator("[data-slot=tour-landing]")).toContainText("Tour step 2");
    await expect(page.locator("[data-point-mark=step]").first()).toBeVisible();
    await expect(page.getByLabel("Changes").getByText("Why here?")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(layout(page)).toHaveAttribute("data-layout", "tour");
    await expect(page.locator(":focus")).toContainText("Step 2:");

    await page.getByRole("button", { name: /^Publish review…/ }).click();
    await expect(page.getByRole("dialog", { name: "Publish review" })).toContainText("Why here?");
  });
}
