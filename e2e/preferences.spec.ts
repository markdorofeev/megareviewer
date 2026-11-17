// Code passed to page.evaluate runs in the browser, so it needs the DOM's types.
/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { focusProblems, pageProblems, unnamedControls } from "./a11y.ts";
import { expect, PR, TOKEN, test } from "./fake-server.ts";

const GUIDED_TITLE = "Add receipt download endpoint, with guidance";
const STALE = "Serves a receipt rendered before a refund for up to an hour";
const NAMING = "`lines` could say what the lines are of";

const everywhere = (page: Page) => page.getByRole("region", { name: "Everywhere" });
const storefront = (page: Page) => page.getByRole("region", { name: /^acme\/storefront/ });
const shop = (page: Page) => page.getByRole("region", { name: /^acme\/shop/ });
const suggested = (page: Page) => page.getByRole("region", { name: "Suggested" });
const preferences = (section: ReturnType<typeof everywhere>) =>
  section.locator("[data-slot=preference]");
const pointCard = (page: Page, title: string) => page.getByRole("article", { name: title });
const chips = (page: Page) =>
  page.locator("[data-slot=review-bar] [data-slot=point-chip]:not([data-kind=thread])");

const openPreferences = async (page: Page) => {
  await page.goto(`/preferences?token=${TOKEN}`);
  await expect(everywhere(page)).toBeVisible();
};

/** Analyzes a PR from its URL, and unless `claude` is false asks for the AI review and waits for it. */
const openReview = async (page: Page, url: string, title: string, claude = true) => {
  await page.goto(`/?token=${TOKEN}`);
  await page.getByRole("textbox", { name: "Pull request link" }).fill(url);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page).toHaveURL(/\/review\/a_[0-9a-f]+$/);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Analysis progress" })).toBeHidden();
  if (!claude) return;
  await page.getByRole("button", { name: "Request AI review" }).click();
  await expect(page.getByText(/^(From the code|✓ Does what was asked):$/)).toBeVisible();
  await expect(page.locator("[data-slot=model-hairline]")).toHaveCount(0);
  await expect(page.locator("[data-landing]")).toHaveAttribute("data-landing", "done");
};

/** Clicks what changes a point's state and waits until the server has it. */
const saved = async (page: Page, state: string, click: () => Promise<void>) => {
  const response = page.waitForResponse(
    (one) => one.url().includes("/points/") && (one.request().postData() ?? "").includes(state),
  );
  await click();
  expect((await response).ok()).toBe(true);
};

test("the header links to the preferences from every page", async ({ page }) => {
  await page.goto(`/?token=${TOKEN}`);
  const link = page.getByRole("link", { name: "Preferences" });
  await expect(link).not.toHaveAttribute("aria-current", "page");
  await link.click();
  await expect(page).toHaveURL(/\/preferences$/);
  await expect(page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
  await expect(link).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page.getByRole("region", { name: "To review" })).toBeVisible();
});

test("adds a preference, switches it off, edits it and deletes it", async ({ page }) => {
  await openPreferences(page);
  const section = everywhere(page);
  await expect(preferences(section)).toHaveCount(0);

  await section.getByRole("button", { name: "Add preference" }).click();
  const form = section.getByRole("form", { name: "Add a preference" });
  // The text has the focus as the form opens, so the rule can be typed and saved with Enter.
  await expect(form.getByRole("textbox")).toBeFocused();
  await page.keyboard.type("Import order");
  await expect(form.locator("[data-slot=character-count]")).toHaveText(/^12\/300/);
  await form.getByRole("button", { name: "Don't flag" }).click();
  await form.getByRole("textbox").press("Enter");
  await expect(preferences(section)).toHaveText(["Don't flagImport orderwritten"]);
  await expect(form).toHaveCount(0);

  const use = section.getByRole("switch", { name: "Use in AI reviews: Import order" });
  await use.click();
  await expect(use).toHaveAttribute("aria-checked", "false");

  // The server has it: it's there, switched off, after a reload.
  await page.reload();
  await expect(preferences(everywhere(page))).toHaveText(["Don't flagImport orderwritten · off"]);

  await section.getByRole("button", { name: "More for: Import order" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const edit = section.getByRole("form", { name: "Edit: Import order" });
  await edit.getByRole("textbox").fill("The order of imports");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(preferences(section)).toHaveText(["Don't flagThe order of importswritten · off"]);

  await section.getByRole("button", { name: "More for: The order of imports" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete preference" });
  await expect(dialog).toContainText("The order of imports");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(preferences(section)).toHaveCount(0);
});

test("suggests from what the reviewer did, and accepts a suggestion", async ({ page }) => {
  await openPreferences(page);
  // Nothing is recorded yet, so there's nothing to suggest from, and the button says so.
  const suggest = page.getByRole("button", { name: "Suggest from my reviews" });
  await expect(suggest).toHaveAttribute("aria-disabled", "true");
  await expect(suggest).toHaveAccessibleDescription(/^Nothing new to suggest from/);
  await expect(suggested(page)).toHaveCount(0);

  // A dismissed point is something to suggest from.
  await openReview(page, PR.smallFeature, "Add receipt download endpoint");
  await saved(page, "dismissed", () =>
    page
      .getByRole("button", { name: /^Dismiss: Check / })
      .first()
      .click(),
  );

  await page.getByRole("link", { name: "Preferences" }).click();
  await expect(page.getByText("1 action recorded since the last suggestions")).toBeVisible();
  await expect(suggest).toHaveAccessibleDescription(/^Runs Sonnet 5\.5 through Claude Code/);
  await suggest.click();
  await expect(page.getByText("2 suggestions from 1 action, above.")).toBeVisible();
  await expect(suggested(page).locator("[data-slot=proposal]")).toHaveCount(2);

  await suggested(page)
    .getByRole("button", { name: "Accept: Missing JSDoc on internal helpers" })
    .click();
  await expect(preferences(shop(page))).toHaveText([
    "Don't flagMissing JSDoc on internal helperslearned",
  ]);
  await suggested(page)
    .getByRole("button", { name: /^Reject: Cached data that outlives/ })
    .click();
  await expect(suggested(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Preferences", level: 1 })).toBeFocused();

  // Accepted and rejected for good: both are as they were after a reload.
  await page.reload();
  await expect(preferences(shop(page))).toHaveCount(1);
  await expect(suggested(page)).toHaveCount(0);
});

test("imports from the reviewer's past reviews of a repository", async ({ page }) => {
  await openReview(page, PR.smallFeature, "Add receipt download endpoint", false);
  await page.getByRole("link", { name: "Preferences" }).click();
  await shop(page).getByRole("button", { name: "Import from my past reviews" }).click();
  await expect(
    shop(page).getByText("Read 3 comments from 2 pull requests: 2 suggestions, above."),
  ).toBeVisible();
  await expect(suggested(page).locator("[data-slot=proposal]")).toHaveCount(2);
  await expect(suggested(page)).toContainText("acme/shop, from your past reviews");
});

test("switches a guideline file, which the next AI review doesn't read", async ({ page }) => {
  await openReview(page, PR.receiptsGuided, GUIDED_TITLE, false);
  await page.getByRole("link", { name: "Preferences" }).click();
  const files = storefront(page).locator("[data-slot=guideline-file]");
  await expect(files).toHaveText([
    /^REVIEW\.md\d+ B$/,
    /^CLAUDE\.md\d+ KBtoo large to send/,
    /^CONTRIBUTING\.md\d+ B$/,
  ]);
  // A file too large to send has no switch.
  await expect(storefront(page).getByRole("switch", { name: /^Read / })).toHaveCount(2);
  const review = storefront(page).getByRole("switch", { name: /^Read REVIEW\.md/ });
  await expect(review).toHaveAttribute("aria-checked", "true");
  await review.click();
  await expect(review).toHaveAttribute("aria-checked", "false");

  await openReview(page, PR.receiptsGuided, GUIDED_TITLE);
  await expect(page.getByRole("button", { name: /Usage:/ })).toHaveText(
    /through Claude Code with 2 preferences · Usage:/,
  );
  await expect(page.locator("[data-slot=point-guidance]")).toHaveText([
    "From your preference: Caches with nothing that invalidates them",
  ]);
});

test("a point says what it's from, a left-out one is shown, and a rule is saved from one", async ({
  page,
}) => {
  await openReview(page, PR.receiptsGuided, GUIDED_TITLE);
  await expect(page.getByRole("button", { name: /Usage:/ })).toHaveText(
    /through Claude Code with 2 preferences and REVIEW\.md · Usage:/,
  );
  await expect(pointCard(page, STALE).locator("[data-slot=point-guidance]")).toHaveText(
    "From your preference: Caches with nothing that invalidates them",
  );
  await expect(page.locator("[data-kind=risk] [data-slot=point-guidance]")).toHaveText(
    "From REVIEW.md",
  );

  // The point "Naming" left out is one line, no step and in no count, with no mark on its line.
  const leftOut = pointCard(page, NAMING);
  await expect(leftOut).toHaveAttribute("data-left-out", "true");
  await expect(leftOut).toContainText("Left out by your preference: Naming");
  await expect(chips(page)).toHaveText([/^1\s*finding$/, /^1\s*risk$/]);
  const marks = page.locator("[data-point-mark=finding]");
  const marked = await marks.count();

  await page.getByRole("button", { name: "Run details…" }).click();
  const details = page.getByRole("dialog");
  await expect(details).toContainText("1 point was left out by them");
  await expect(
    details
      .getByRole("region", { name: "What the run read beside the code" })
      .getByRole("listitem"),
  ).toHaveCount(3);
  await page.keyboard.press("Escape");

  await leftOut.getByRole("button", { name: `Show: ${NAMING}` }).click();
  await expect(leftOut).not.toHaveAttribute("data-left-out");
  await expect(leftOut).toBeFocused();
  await expect(leftOut.locator("[data-slot=point-guidance]")).toHaveText(
    "Left out by your preference: Naming",
  );
  await expect(chips(page)).toHaveText([/^2\s*findings$/, /^1\s*risk$/]);
  await expect(marks).toHaveCount(marked + 1);

  // "Don't flag things like this" on the other finding: a rule for this repository, then dismissed.
  const stale = pointCard(page, STALE);
  await stale.getByRole("button", { name: `More ways to dismiss: ${STALE}` }).click();
  await page.getByRole("menuitem", { name: "Don't flag things like this…" }).click();
  const form = stale.getByRole("form");
  await expect(form.getByRole("textbox")).toHaveValue(STALE);
  await expect(form.getByRole("combobox", { name: "Applies to" })).toContainText("acme/storefront");
  await form.getByRole("textbox").fill("Receipts cached for an hour");
  await saved(page, "dismissed", () =>
    form.getByRole("button", { name: "Save and dismiss" }).click(),
  );
  await expect(stale).toHaveAttribute("data-state", "dismissed");
  await expect(stale).toContainText("Dismissed, and saved to your preferences");

  await stale.getByRole("link", { name: "preferences" }).click();
  await expect(preferences(storefront(page))).toHaveText([
    "Look forCaches with nothing that invalidates themwritten",
    "Don't flagNamingwritten",
    "Don't flagReceipts cached for an hourlearned",
  ]);
});

test("never scrolls sideways", async ({ page }) => {
  await openReview(page, PR.receiptsGuided, GUIDED_TITLE, false);
  await page.getByRole("link", { name: "Preferences" }).click();
  await expect(storefront(page).locator("[data-slot=guideline-file]")).toHaveCount(3);
  await storefront(page)
    .getByRole("button", { name: /^Add preference/ })
    .click();
  for (const width of [1440, 1024, 768, 375]) {
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
      // A repository with guideline files, proposals waiting, and the form open.
      await openReview(page, PR.receiptsGuided, GUIDED_TITLE, false);
      await openReview(page, PR.smallFeature, "Add receipt download endpoint", false);
      await page.getByRole("link", { name: "Preferences" }).click();
      await expect(storefront(page).locator("[data-slot=guideline-file]")).toHaveCount(3);
      await shop(page).getByRole("button", { name: "Import from my past reviews" }).click();
      await expect(suggested(page).locator("[data-slot=proposal]")).toHaveCount(2);
      await everywhere(page).getByRole("button", { name: "Add preference" }).click();
      const focus = await focusProblems(page);
      await expect(page.locator("[data-slot=tooltip-content]")).toHaveCount(0);
      expect([
        ...(await unnamedControls(page)),
        ...(await pageProblems(page)),
        ...focus.problems,
      ]).toEqual([]);
    });
  }
}
