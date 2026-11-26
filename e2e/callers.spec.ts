import type { Page } from "@playwright/test";
import { expect, PR, TOKEN, test } from "./fake-server.ts";

test.use({ download: true, viewport: { width: 1280, height: 600 } });

const TITLE = "Add receipt download endpoint, with callers";

const open = async (page: Page) => {
  await page.goto(`/?token=${TOKEN}`);
  await page.getByRole("textbox", { name: "Pull request link" }).fill(PR.receiptsDownloaded);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: TITLE, level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Analysis progress" })).toBeHidden();
};

/** The byline's item, which says how much of the repository was read. */
const repository = (page: Page) => page.locator("[data-slot=repository-status]");

/** The item's note, in its popover, which it opens. */
const note = async (page: Page) => {
  await repository(page).click();
  const popover = page.getByRole("dialog");
  await expect(popover).toBeVisible();
  return popover.locator("[data-slot=checkout-note]");
};

test("callers arrive after the review opened, on the same review, without moving the code", async ({
  page,
  server,
}) => {
  await server.request.post("/__fake/hold-downloads");
  await open(page);
  const { pathname } = new URL(page.url());
  await expect(repository(page)).toHaveText("Downloading repository…");
  await expect(await note(page)).toContainText(
    "Downloading acme/shop to find the code that calls what this pull request changes.",
  );
  await page.keyboard.press("Escape");

  // A draft, and the code read further down than where the callers come.
  const changes = page.getByRole("region", { name: "Changes" });
  const money = changes.locator('[data-slot=file-card][data-path="src/lib/money.ts"]');
  const receipts = changes.locator('[data-slot=file-card][data-path="src/services/receipts.ts"]');
  const number = receipts.getByRole("button", { name: /^Comment on line \d+$/ }).nth(4);
  await number.click();
  await changes.getByRole("textbox", { name: /^Comment on line/ }).fill("Who reads this cache?");
  await changes.getByRole("button", { name: "Add to review", exact: true }).click();
  const line = receipts.getByText("cache.set(order.id");
  await line.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  const uses = money.locator("[data-slot=unchanged-uses]");
  await expect(uses).toHaveCount(0);
  const height = (await money.boundingBox())?.height ?? 0;
  const top = (await line.boundingBox())?.y ?? 0;

  await server.request.post("/__fake/release-downloads");
  await expect(uses).toHaveCount(1);
  expect((await money.boundingBox())?.height ?? 0).toBeGreaterThan(height);
  expect(Math.abs(((await line.boundingBox())?.y ?? 0) - top)).toBeLessThanOrEqual(1);
  await expect(page.locator("[data-landing]")).toHaveAttribute("data-landing", "done");

  expect(new URL(page.url()).pathname).toBe(pathname);
  await expect(receipts.getByText("Who reads this cache?")).toBeVisible();
  await money.getByRole("button", { name: "Used unchanged in 1 place" }).click();
  await expect(money).toContainText("src/invoice.ts");
  await expect(repository(page)).toHaveText("Whole repository");
  await expect(await note(page)).toContainText(
    "from its own copy in ~/.megareviewer/repos/github/acme/shop.git. It found 1 use",
  );
  await page.keyboard.press("Escape");

  // Opened again, it's the same review, with the callers.
  await page.reload();
  await expect(uses).toHaveCount(1);
  await expect(receipts.getByText("Who reads this cache?")).toBeVisible();
});

test("a download that fails leaves the review as it is, and says why", async ({ page }) => {
  await page.goto(`/?token=${TOKEN}`);
  // The fake host has the head commit of one pull request only.
  await page.getByRole("textbox", { name: "Pull request link" }).fill(PR.smallFeature);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("list", { name: "Analysis progress" })).toBeHidden();
  await expect(repository(page)).toHaveText("PR only");
  await expect(await note(page)).toContainText("the repository couldn't be downloaded.");
  await expect(page.locator("[data-slot=file-card]").first()).toBeAttached();
});
