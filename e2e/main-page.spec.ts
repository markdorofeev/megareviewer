// Code passed to page.evaluate runs in the browser, so it needs the DOM's types.
/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { focusProblems, pageProblems, unnamedControls } from "./a11y.ts";
import { expect, PR, TOKEN, test } from "./fake-server.ts";

const field = (page: Page) => page.getByRole("textbox", { name: "Pull request link" });
const toReview = (page: Page) => page.getByRole("region", { name: "To review" });
const yours = (page: Page) => page.getByRole("region", { name: "Your pull requests" });

const openPicker = async (page: Page) => {
  await page.goto(`/?token=${TOKEN}`);
  await expect(toReview(page).locator("[data-pr-row]").first()).toBeVisible();
};

test("opens a review from a row", async ({ page }) => {
  await openPicker(page);
  await toReview(page).locator("[data-pr-row]").first().click();
  await expect(page).toHaveURL(/\/review\/a_[0-9a-f]+$/);
});

test("opens a review from a link without its scheme", async ({ page }) => {
  await openPicker(page);
  await field(page).fill(PR.smallFeature.replace("https://", ""));
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page).toHaveURL(/\/review\/a_[0-9a-f]+$/);
});

test("shows a reply in the calendar the same day", async ({ page }) => {
  await openPicker(page);
  const today = page.getByRole("gridcell", { name: /\(today\)$/ });
  await expect(today).toHaveAccessibleName(/0 comments \(today\)$/);

  await field(page).fill(PR.smallFeature);
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  const thread = page.getByRole("article", { name: "Thread on line 4", exact: true });
  await thread.getByRole("button", { name: "Reply…" }).click();
  await thread.getByRole("textbox", { name: "Reply to the thread on line 4" }).fill("Capped.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(thread.getByText("Capped.")).toBeVisible();

  await page.getByRole("link", { name: "megareviewer" }).click();
  await expect(today).toHaveAccessibleName(/1 comment \(today\)$/);
});

/** A row is at least 58 px high, so a list's first row ends this far under its header. */
const ROW_PX = 58;

test("shows the first row of each list above 300 px at 1280 × 800", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPicker(page);
  const row = await toReview(page).locator("[data-pr-row]").first().boundingBox();
  expect((row?.y ?? Number.POSITIVE_INFINITY) + (row?.height ?? 0)).toBeLessThanOrEqual(300);
  // The fake reviewer has no PRs of their own: where their first row would end.
  const header = await yours(page).getByRole("heading").boundingBox();
  expect((header?.y ?? Number.POSITIVE_INFINITY) + 32 + ROW_PX).toBeLessThanOrEqual(300);
});

test("never scrolls sideways", async ({ page }) => {
  await openPicker(page);
  for (const width of [1440, 1280, 1024, 768, 640, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        { message: `at ${width} px` },
      )
      .toBeLessThanOrEqual(0);
  }
});

test("opens Connections from the keyboard, and Esc gives the focus back", async ({ page }) => {
  await openPicker(page);
  const button = page.getByRole("button", { name: /^Connections:/ });
  await expect(button).toHaveText(/connected$/);
  await button.focus();
  await page.keyboard.press("Enter");
  const checkAgain = page.getByRole("button", { name: "Check again" });
  await expect(checkAgain).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(checkAgain).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(checkAgain).toBeHidden();
  await expect(button).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  for (const palette of ["default", "cb"] as const) {
    test(`meets the accessibility checks, ${theme} ${palette}`, async ({ page }) => {
      await page.addInitScript(
        ([storedTheme, storedPalette]) => {
          window.localStorage.setItem("megareviewer:theme", JSON.stringify(storedTheme));
          window.localStorage.setItem("megareviewer:diffPalette", JSON.stringify(storedPalette));
        },
        [theme, palette],
      );
      await openPicker(page);
      await expect(page.getByRole("grid")).toBeVisible();
      const focus = await focusProblems(page);
      // The walk passes the calendar, whose tooltip fades out after it: contrast reads it at rest.
      await expect(page.locator("[data-slot=tooltip-content]")).toHaveCount(0);
      expect([
        ...(await unnamedControls(page)),
        ...(await pageProblems(page)),
        ...focus.problems,
      ]).toEqual([]);
    });
  }
}
