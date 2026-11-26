// Code passed to page.evaluate runs in the browser, so it needs the DOM's types.
/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { focusProblems, pageProblems, unnamedControls } from "./a11y.ts";
import { expect, PR, TOKEN, test } from "./fake-server.ts";

const GUIDED_TITLE = "Add receipt download endpoint, with guidance";
const HARNESS_TITLE = "Add receipt download endpoint, with a harness";
const STALE = "Serves a receipt rendered before a refund for up to an hour";
const RATE_LIMIT = "Raises the rate limit tenfold without saying who asked for it";
const NAMING = "`lines` could say what the lines are of";

const everywhere = (page: Page) => page.getByRole("region", { name: "Everywhere", exact: true });
const storefront = (page: Page) =>
  page.getByRole("region", { name: "acme/storefront", exact: true });
const warehouse = (page: Page) => page.getByRole("region", { name: "acme/warehouse", exact: true });
const shop = (page: Page) => page.getByRole("region", { name: "acme/shop", exact: true });
const suggestions = (page: Page) => page.getByRole("region", { name: "Suggestions", exact: true });
const preferences = (section: ReturnType<typeof everywhere>) =>
  section.locator("[data-slot=preference]");
const proposals = (section: ReturnType<typeof everywhere>) =>
  section.locator("[data-slot=proposal]");
/** Opens a scope's panel from the list beside it. */
const openScope = (page: Page, name: RegExp) =>
  page.getByRole("navigation", { name: "Scopes" }).getByRole("button", { name }).click();
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
  await expect(page).toHaveURL(/\/review\/a_[0-9a-f]+(\?view=\w+)?$/);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Analysis progress" })).toBeHidden();
  if (!claude) return;
  await page.getByRole("button", { name: "Request AI review" }).click();
  await expect(page.getByText(/^(From the code|Does what was asked):$/)).toBeVisible();
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
  await expect(section).toContainText("No preferences for every repository yet.");

  // The form is always open, so the rule can be typed and saved with Enter.
  const form = section.getByRole("form", { name: "Add a preference" });
  await form.getByRole("textbox").click();
  await page.keyboard.type("Import order");
  // The count shows only as a rule nears its limit.
  await expect(form.locator("[data-slot=character-count]")).toHaveCount(0);
  await form.getByRole("radio", { name: "Don't flag" }).click();
  await form.getByRole("textbox").press("Enter");
  await expect(preferences(section)).toHaveText(["Don't flagImport order"]);
  await expect(form.getByRole("textbox")).toHaveValue("");
  await expect(form.getByRole("radio", { name: "Don't flag" })).toBeChecked();

  const use = section.getByRole("switch", { name: "Use in AI reviews: Import order" });
  await use.click();
  await expect(use).toHaveAttribute("aria-checked", "false");

  // The server has it: it's there, switched off, after a reload.
  await page.reload();
  await expect(preferences(everywhere(page))).toHaveText(["Don't flagImport orderoff"]);

  await section.getByRole("button", { name: "Edit: Import order" }).click();
  const edit = section.getByRole("form", { name: "Edit: Import order" });
  await expect(edit.getByRole("textbox")).toBeFocused();
  await edit.getByRole("textbox").fill("The order of imports");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(preferences(section)).toHaveText(["Don't flagThe order of importsoff"]);
  await expect(section.getByRole("button", { name: "Edit: The order of imports" })).toBeFocused();

  await section.getByRole("button", { name: "Delete: The order of imports" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete preference" });
  await expect(dialog).toContainText("The order of imports");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(preferences(section)).toHaveCount(0);
});

test("keeps the scope chosen in the URL, through a reload and Back", async ({ page }) => {
  await openReview(page, PR.smallFeature, "Add receipt download endpoint", false);
  await page.getByRole("link", { name: "Preferences" }).click();
  await expect(everywhere(page)).toBeVisible();
  await openScope(page, /^acme\/shop/);
  await expect(page).toHaveURL(/\/preferences\?scope=github\/acme\/shop$/);
  await expect(shop(page).getByRole("heading", { level: 2, name: "acme/shop" })).toBeFocused();
  await page.reload();
  await expect(shop(page)).toBeVisible();
  await page.goBack();
  await expect(everywhere(page)).toBeVisible();

  // Under 1024px the list is a select.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByRole("navigation", { name: "Scopes" })).toBeHidden();
  await page.getByRole("combobox", { name: "Scope" }).click();
  await page.getByRole("option", { name: /^acme\/shop/ }).click();
  await expect(shop(page)).toBeVisible();
  await expect(shop(page).getByRole("heading", { level: 2 })).toBeFocused();
});

test("suggests for a repository from its host's comments and what the reviewer did", async ({
  page,
}) => {
  // A dismissed point is something to suggest from, beside the reviewer's comments on the host.
  await openReview(page, PR.smallFeature, "Add receipt download endpoint");
  await saved(page, "dismissed", () =>
    page
      .getByRole("button", { name: /^Dismiss: Check / })
      .first()
      .click(),
  );

  await page.getByRole("link", { name: "Preferences" }).click();
  await expect(everywhere(page)).toBeVisible();
  const suggest = page.getByRole("button", { name: "Suggest from my reviews" });
  // Only a repository's panel has it.
  await expect(suggest).toHaveCount(0);
  await openScope(page, /^acme\/shop/);
  await expect(suggest).toHaveAccessibleDescription(
    /^Reads what you did on its pull requests here and your comments on GitHub, then runs Sonnet 5\.5 through Claude Code/,
  );
  await suggest.click();
  // Each suggestion goes to the panel of its scope, and the line says where.
  await expect(
    shop(page).getByText(
      "Read 3 comments from 2 pull requests and 1 action recorded here: 2 suggestions, 1 for Everywhere and 1 for acme/shop.",
    ),
  ).toBeVisible();
  await expect(proposals(shop(page))).toHaveCount(1);

  await openScope(page, /^Suggestions/);
  await expect(proposals(suggestions(page))).toHaveCount(2);
  await suggestions(page)
    .getByRole("button", { name: "Add suggestion: Missing JSDoc on internal helpers" })
    .click();
  await expect(proposals(suggestions(page))).toHaveCount(1);
  await suggestions(page)
    .getByRole("button", { name: /^Dismiss suggestion: Cached data that outlives/ })
    .click();
  await expect(proposals(suggestions(page))).toHaveCount(0);
  await expect(suggestions(page)).toContainText("No suggestions yet.");
  await expect(suggestions(page).getByRole("heading", { level: 2 })).toBeFocused();

  // Added and dismissed for good: both are as they were after a reload.
  await openScope(page, /^acme\/shop/);
  await expect(preferences(shop(page))).toHaveText([
    "Don't flagMissing JSDoc on internal helpersFrom your reviews",
  ]);
  await page.reload();
  await expect(preferences(shop(page))).toHaveCount(1);
  await expect(proposals(shop(page))).toHaveCount(0);
});

test("switches a guideline file, which the next AI review doesn't read", async ({ page }) => {
  await openReview(page, PR.receiptsGuided, GUIDED_TITLE, false);
  await page.getByRole("link", { name: "Preferences" }).click();
  await openScope(page, /^acme\/storefront/);
  const files = storefront(page).locator("[data-slot=guideline-file]");
  await expect(files).toHaveText([
    /^REVIEW\.md\d+ BIn every review$/,
    /^CLAUDE\.md\d+ KBIgnored$/,
    /^CONTRIBUTING\.md\d+ BIgnored$/,
  ]);
  // A file too large for a prompt is read when the model asks.
  const claude = storefront(page).getByRole("switch", { name: "Use CLAUDE.md in AI reviews" });
  await claude.click();
  await expect(files.nth(1)).toHaveText(/^CLAUDE\.md\d+ KBRead when the model asks$/);
  await claude.click();
  await expect(files.nth(1)).toHaveText(/Ignored$/);
  const review = storefront(page).getByRole("switch", { name: "Use REVIEW.md in AI reviews" });
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

test("unfolds what a guideline file links, and switches a linked file off", async ({ page }) => {
  await openReview(page, PR.receiptsHarness, HARNESS_TITLE, false);
  const ask = page.getByRole("button", { name: "Request AI review" });
  await expect(ask).toHaveAccessibleDescription(/\. Reads REVIEW\.md; 2 more on request$/);
  await page.getByRole("link", { name: "Preferences" }).click();
  await openScope(page, /^acme\/warehouse/);
  const section = warehouse(page);
  const fold = section.getByRole("button", { name: "7 linked files, 70 KB, from CLAUDE.md" });
  const uses = section.locator("[data-slot=linked-uses]").nth(1);
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(uses).toHaveText("When on: 2 in every review, 5 on request");
  await expect(section.locator("[data-slot=harness-notes]")).toHaveText(
    "docs/changelog.md is over 1 MB, so AI reviews don't use it.",
  );

  await fold.focus();
  await page.keyboard.press("Enter");
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(
    section.getByRole("list", { name: "Linked by docs/runbooks/README.md" }).getByRole("listitem"),
  ).toHaveCount(2);
  await section.getByRole("switch", { name: "Use CLAUDE.md in AI reviews" }).click();
  await expect(uses).toHaveText("2 in every review, 5 on request");
  const runbooks = section.getByRole("switch", {
    name: "Use docs/runbooks/README.md in AI reviews",
  });
  await runbooks.click();
  await expect(runbooks).toHaveAttribute("aria-checked", "false");
  // The two it links have no other way in.
  await expect(uses).toHaveText("2 in every review, 2 on request, 3 ignored");

  await page.reload();
  await expect(uses).toHaveText("2 in every review, 2 on request, 3 ignored");
  await fold.click();
  await expect(runbooks).toHaveAttribute("aria-checked", "false");

  await openReview(page, PR.receiptsHarness, HARNESS_TITLE, false);
  await expect(ask).toHaveAccessibleDescription(
    /\. Reads REVIEW\.md, CLAUDE\.md, and 2 files they import; 2 more on request$/,
  );
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
  await expect(pointCard(page, RATE_LIMIT).locator("[data-slot=point-guidance]")).toHaveText(
    "From REVIEW.md",
  );

  // The point "Naming" left out is one line, no step and in no count, with no mark on its line.
  const leftOut = pointCard(page, NAMING);
  await expect(leftOut).toHaveAttribute("data-left-out", "true");
  await expect(leftOut).toContainText("Left out by your preference: Naming");
  await expect(chips(page)).toHaveText([/^ƒ\s*1\s*logic$/, /^◆\s*1\s*contract$/]);
  const marks = page.locator("[data-point-mark]");
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
  await expect(chips(page)).toHaveText([/^ƒ\s*2\s*logic$/, /^◆\s*1\s*contract$/]);
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
  await openScope(page, /^acme\/storefront/);
  await expect(preferences(storefront(page))).toHaveText([
    "Look forCaches with nothing that invalidates them",
    "Don't flagNaming",
    "Don't flagReceipts cached for an hourFrom your reviews",
  ]);
});

test("never scrolls sideways", async ({ page }) => {
  await openReview(page, PR.receiptsHarness, HARNESS_TITLE, false);
  await page.getByRole("link", { name: "Preferences" }).click();
  await openScope(page, /^acme\/warehouse/);
  await warehouse(page)
    .getByRole("button", { name: /from CLAUDE\.md$/ })
    .click();
  await expect(warehouse(page).locator("[data-slot=linked-file]")).toHaveCount(7);
  for (const width of [1440, 1024, 900, 768, 375]) {
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

/** What the accessibility checks find on the page as it is. */
const problems = async (page: Page) => {
  const focus = await focusProblems(page);
  await expect(page.locator("[data-slot=tooltip-content]")).toHaveCount(0);
  return [...(await unnamedControls(page)), ...(await pageProblems(page)), ...focus.problems];
};

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
      // A repository with proposals waiting, one with preferences and guideline files, and one
      // whose guideline file links others, unfolded.
      await openReview(page, PR.receiptsHarness, HARNESS_TITLE, false);
      await openReview(page, PR.receiptsGuided, GUIDED_TITLE, false);
      await openReview(page, PR.smallFeature, "Add receipt download endpoint", false);
      await page.getByRole("link", { name: "Preferences" }).click();
      await openScope(page, /^acme\/shop/);
      await shop(page).getByRole("button", { name: "Suggest from my reviews" }).click();
      await expect(proposals(shop(page))).toHaveCount(1);
      expect(await problems(page)).toEqual([]);
      await openScope(page, /^acme\/storefront/);
      await expect(storefront(page).locator("[data-slot=guideline-file]")).toHaveCount(3);
      await storefront(page).getByRole("textbox").fill("x".repeat(310));
      expect(await problems(page)).toEqual([]);
      await openScope(page, /^acme\/warehouse/);
      await warehouse(page)
        .getByRole("button", { name: /from CLAUDE\.md$/ })
        .click();
      await warehouse(page)
        .getByRole("switch", { name: "Use docs/testing.md in AI reviews" })
        .click();
      expect(await problems(page)).toEqual([]);
    });
  }
}
