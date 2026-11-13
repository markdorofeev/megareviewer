import type { Locator, Page } from "@playwright/test";
import { z } from "zod";
import { expect, PR, publishAttempts, TOKEN, test } from "./fake-server.ts";

const SMALL_FEATURE_TITLE = "Add receipt download endpoint";

/** Opens the picker the way the CLI's link does. */
const openPicker = async (page: Page) => {
  await page.goto(`/?token=${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Review a pull request" })).toBeVisible();
};

/** Analyzes a PR from its URL and waits until the review is complete. */
const openReview = async (page: Page, url: string, title: string) => {
  await openPicker(page);
  await page.getByLabel("Pull request URL").fill(url);
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page).toHaveURL(/\/review\/a_[0-9a-f]+$/);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  // The progress strip goes once the analysis is complete.
  await expect(page.getByRole("list", { name: "Analysis progress" })).toBeHidden();
};

const decision = (page: Page, path: string) => ({
  approve: page.getByRole("button", { name: `Approve: Changes ${path}` }),
  reject: page.getByRole("button", { name: `Reject: Changes ${path}` }),
  comment: page.getByRole("textbox", { name: `Comment on: Changes ${path}` }),
});

/** Types a comment and waits until the server has it (comments save after a pause). */
const writeComment = async (page: Page, textbox: Locator, text: string) => {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/verdicts/") && (response.request().postData() ?? "").includes(text),
  );
  await textbox.fill(text);
  expect((await saved).ok()).toBe(true);
};

/** Waits until every verdict change so far has been saved. */
const allSaved = (page: Page, count: number) =>
  expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveCount(count);

test("the token bootstraps the session and leaves the URL", async ({ page, browser, server }) => {
  await openPicker(page);
  await expect(page).toHaveURL(`${server.url}/`);

  const fresh = await browser.newPage();
  await fresh.goto(`${server.url}/`);
  await expect(
    fresh.getByRole("heading", { name: "Open megareviewer from your terminal" }),
  ).toBeVisible();
  await fresh.close();

  const anonymous = await fetch(`${server.url}/api/status`);
  expect(anonymous.status).toBe(401);
});

test("analyzes a PR from its URL", async ({ page }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  await expect(page.getByRole("list", { name: "Analysis progress" })).toBeHidden();
  await expect(page.getByText(/^(From the code|✓ Does what was asked):$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Details" })).toBeVisible();
});

test("analyzes a PR picked from the list", async ({ page }) => {
  await openPicker(page);
  await page.getByRole("button", { name: /Fix crash when refunding store-credit orders/ }).click();
  await expect(
    page.getByRole("heading", { name: "Fix crash when refunding store-credit orders", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Publish review…/ })).toBeEnabled();
});

test("the map moves between the files with the keyboard", async ({ page }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  const files = await page
    .locator("[aria-label=Changes] [data-slot=file-card]")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-label") ?? ""));
  // In path order, as a directory tree lists them.
  expect(files).toEqual(["config/app.yaml", "src/routes/orders.ts", "src/services/receipts.ts"]);
  const [first, second] = files;
  if (first === undefined || second === undefined) throw new Error("expected two files");
  await page.locator("[aria-label=Changes] [data-slot=file-card-header]").first().click();
  const focused = page.locator("[aria-label=Changes] [data-slot=file-card]:focus");
  await page.keyboard.press("n");
  await expect(focused).toHaveAttribute("aria-label", second);
  await page.keyboard.press("p");
  await expect(focused).toHaveAttribute("aria-label", first);
});

test("a call shows the code it runs while the pointer is on it or on its card", async ({
  page,
}) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  const call = page.locator("[data-slot=call]", { hasText: "renderReceipt" }).first();
  const card = page.getByLabel("Code renderReceipt runs");
  await call.hover();
  await expect(card).toBeVisible();
  await expect(card.getByRole("table", { name: "Lines of renderReceipt" })).toContainText(
    "renderReceipt",
  );
  // The pointer crosses to the card, and the card stays while it's there.
  await card.hover();
  await page.waitForTimeout(600);
  await expect(card).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(card).toBeHidden();
  // Go to file goes to the part on the map, and the card closes.
  await call.hover();
  await card.getByRole("button", { name: "Go to file" }).click();
  await expect(card).toBeHidden();
  await expect(page.locator("[data-slot=hunk-card]:focus")).toContainText("renderReceipt");
});

test("a call's card keeps its header in view when its code scrolls sideways", async ({ page }) => {
  // Narrow enough that the code is wider than the card.
  await page.setViewportSize({ width: 560, height: 800 });
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  await page.locator("[data-slot=call]", { hasText: "renderReceipt" }).first().hover();
  const card = page.getByLabel("Code renderReceipt runs");
  await expect(card).toBeVisible();
  const scroller = card.locator("[data-slot=peek-scroller]");
  expect(await scroller.evaluate((box) => box.scrollWidth > box.clientWidth)).toBe(true);
  await scroller.evaluate((box) => {
    box.scrollLeft = box.scrollWidth;
  });
  const goTo = card.getByRole("button", { name: "Go to file" });
  const header = card.locator("header").first();
  const [cardBox, headerBox, goToBox] = await Promise.all([
    card.boundingBox(),
    header.boundingBox(),
    goTo.boundingBox(),
  ]);
  if (cardBox === null || headerBox === null || goToBox === null) throw new Error("not laid out");
  expect(Math.abs(headerBox.x - cardBox.x)).toBeLessThan(2);
  expect(goToBox.x + goToBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
});

test("the line under the mouse shows a plus on its number, an unchanged fold's doesn't", async ({
  page,
}) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  const primary = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--primary)";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  const look = (number: Locator) =>
    number.evaluate((element) => ({
      plus: getComputedStyle(element, "::before").content,
      fill: getComputedStyle(element).backgroundColor,
    }));
  const tint = (row: Locator) =>
    row.evaluate((element) => getComputedStyle(element, "::before").backgroundColor);

  const card = page
    .locator("[aria-label=Changes] [data-slot=file-card]")
    .filter({ has: page.locator("[data-slot=file-gap]") })
    .first();
  const commentable = card
    .locator("[role=row]")
    .filter({ has: page.getByRole("button") })
    .first();
  const number = commentable.getByRole("button", { name: /^Comment on/ });
  await commentable.locator("[role=cell]").last().hover();
  expect(await look(number)).toEqual({ plus: '"+"', fill: primary });
  expect(await tint(commentable)).not.toBe("rgba(0, 0, 0, 0)");

  await card.locator("[data-slot=file-gap]").getByRole("button").first().click();
  const unchanged = card
    .locator("[role=row]")
    .filter({ hasNot: page.getByRole("button") })
    .first();
  await unchanged.hover();
  await expect(unchanged.getByRole("button")).toHaveCount(0);
  expect(await tint(unchanged)).toBe("rgba(0, 0, 0, 0)");
  expect((await look(number)).plus).toBe("none");
});

test("mechanical changes are collapsed until expanded", async ({ page }) => {
  await openReview(page, PR.refactorMove, "Tidy up utilities");
  const group = page.getByRole("region", { name: /Mechanical changes/ });
  const toggles = group.getByRole("button", { expanded: false });
  await expect(toggles.first()).toBeVisible();
  await expect(group.locator("[data-slot=hunk-card]")).toHaveCount(0);

  await toggles.first().click();
  await expect(group.getByRole("button", { expanded: true })).toHaveCount(1);
  await expect(group.locator("[data-slot=hunk-card]")).toHaveCount(1);
});

test("verdicts and comments persist across a reload", async ({ page }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  const config = decision(page, "config/app.yaml");
  const routes = decision(page, "src/routes/orders.ts");

  await config.approve.click();
  await routes.reject.click();
  await writeComment(page, routes.comment, "Scope this to the order's owner.");
  await allSaved(page, 2);

  await page.reload();
  await expect(config.approve).toHaveAttribute("aria-pressed", "true");
  await expect(routes.reject).toHaveAttribute("aria-pressed", "true");
  await expect(routes.comment).toHaveValue("Scope this to the order's owner.");
});

test("publishes exactly what the preview shows, once", async ({ page, server }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  await decision(page, "config/app.yaml").approve.click();
  const routes = decision(page, "src/routes/orders.ts");
  await routes.reject.click();
  await writeComment(page, routes.comment, "Scope this to the order's owner.");
  await allSaved(page, 2);

  await page.getByRole("button", { name: /^Publish review…/ }).click();
  const dialog = page.getByRole("dialog", { name: "Publish 1 comment" });
  await expect(dialog.getByText(/^src\/routes\/orders\.ts:/)).toBeVisible();
  await dialog.getByRole("button", { name: "Publish 1 comment" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Published" })).toBeVisible();

  const [attempt, ...others] = await publishAttempts(server);
  expect(others).toEqual([]);
  expect(attempt?.outcome).toBe("published");
  expect(attempt?.publication.verdict).toBe("request_changes");
  expect(attempt?.publication.comments.map((comment) => comment.body)).toEqual([
    "**Rejected: Changes src/routes/orders.ts**\n\nScope this to the order's owner.",
  ]);
  expect(attempt?.postedKeys).toEqual(["summary", "decision:d2"]);

  // Line comments stay open once it's published: they post now, as threads of their own.
  const changes = page.getByRole("region", { name: "Changes" });
  const number = changes.getByRole("button", { name: /^Comment on line \d+$/ }).first();
  const line = await number.textContent();
  await number.click();
  await changes.getByRole("textbox", { name: `Comment on line ${line}` }).fill("One more.");
  await expect(changes.getByRole("button", { name: /^Add to review/ })).toHaveCount(0);
  await changes.getByRole("button", { name: "Comment now" }).click();
  await expect(
    changes
      .getByRole("article", { name: `Thread on line ${line}`, exact: true })
      .getByText("One more."),
  ).toBeVisible();

  // Publishing again returns the receipt and posts nothing.
  const analysisId = page.url().split("/").at(-1);
  const again = await server.request.post(`/api/analyses/${analysisId}/publication`, {
    data: { summary: "", allowStale: false },
  });
  expect(again.ok()).toBe(true);
  expect(await publishAttempts(server)).toHaveLength(1);
});

test("a publish that fails part-way posts only the rest on retry", async ({ page, server }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  await decision(page, "config/app.yaml").reject.click();
  await decision(page, "src/routes/orders.ts").reject.click();
  await allSaved(page, 2);
  // Post 1 is the summary, so the second inline comment is post 3.
  const armed = await server.request.post("/__fake/fail-publish-comment", { data: { n: 3 } });
  expect(armed.ok()).toBe(true);

  await page.getByRole("button", { name: /^Publish review…/ }).click();
  const dialog = page.getByRole("dialog", { name: "Publish 2 comments" });
  await dialog.getByRole("button", { name: "Publish 2 comments" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Retrying is safe");
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog).toBeHidden();

  const attempts = await publishAttempts(server);
  expect(attempts.map((attempt) => [attempt.outcome, attempt.postedKeys])).toEqual([
    ["failed", ["summary", "decision:d1"]],
    ["published", ["decision:d2"]],
  ]);
});

test("a failed analysis shows where it failed, and retries", async ({ page }) => {
  await openPicker(page);
  await page.getByLabel("Pull request URL").fill(PR.intentFailsOnce);
  await page.getByRole("button", { name: "Analyze" }).click();

  const progress = page.getByRole("list", { name: "Analysis progress" });
  await expect(progress.getByText("Intent: failed")).toBeAttached();
  await expect(progress.getByText("Collect: done")).toBeAttached();
  const failure = page.getByRole("alert").filter({ hasText: "The analysis failed at the intent" });
  await expect(failure).toContainText("Retry the analysis");

  await failure.getByRole("button", { name: "Retry" }).click();
  await expect(failure).toBeHidden();
  await expect(page.getByRole("button", { name: /^Publish review…/ })).toBeEnabled();
});

test("a PR with new commits warns, and publishing asks first", async ({ page, server }) => {
  await openPicker(page);
  // The analysis keeps the head it started with; the push lands while it runs.
  const started = await server.request.post("/api/analyses", { data: { url: PR.smallFeature } });
  expect(started.ok()).toBe(true);
  const { analysisId } = z.object({ analysisId: z.string() }).parse(await started.json());
  const pushed = await server.request.post("/__fake/set-head", {
    data: { url: PR.smallFeature, headSha: "1".repeat(40) },
  });
  expect(pushed.ok()).toBe(true);

  await page.goto(`/review/${analysisId}`);
  await expect(page.getByRole("status").filter({ hasText: "new commits" })).toBeVisible();

  await page.getByRole("button", { name: /^Publish review…/ }).click();
  const dialog = page.getByRole("dialog", { name: "Publish the review" });
  await dialog.getByRole("button", { name: "Publish the review" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Publish anyway?");
  expect(await publishAttempts(server)).toEqual([]);

  await dialog.getByRole("button", { name: "Publish anyway" }).click();
  await expect(dialog).toBeHidden();
  expect(await publishAttempts(server)).toHaveLength(1);
});

test("replies to a thread and resolves it", async ({ page }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  const changes = page.getByRole("region", { name: "Changes" });

  const cache = changes.getByRole("article", { name: "Thread on line 4", exact: true });
  await expect(cache.getByText("major")).toBeVisible();
  await cache.getByRole("button", { name: "Reply…" }).click();
  const reply = cache.getByRole("textbox", { name: "Reply to the thread on line 4" });
  await expect(reply).toBeFocused();
  await reply.fill("Capped at 1,000 entries.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(cache.getByText("Capped at 1,000 entries.")).toBeVisible();
  await expect(reply).toBeHidden();
  await cache.getByRole("button", { name: /^Resolve/ }).click();
  await expect(
    changes.getByRole("article", { name: "Thread on line 4, resolved", exact: true }),
  ).toBeVisible();
});

test("posts a comment now, and it comes back as a thread", async ({ page }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  const changes = page.getByRole("region", { name: "Changes" });
  const number = changes.getByRole("button", { name: /^Comment on line \d+$/ }).first();
  const line = await number.textContent();
  await number.click();
  const field = changes.getByRole("textbox", { name: `Comment on line ${line}` });
  await field.fill("Why this, and not a config value?");
  await changes.getByRole("button", { name: "Comment now" }).click();
  await expect(field).toBeHidden();
  const thread = changes.getByRole("article", { name: `Thread on line ${line}`, exact: true });
  await expect(thread.getByText("Why this, and not a config value?")).toBeVisible();
});

test.describe("without the model", () => {
  test.use({ ai: false });

  test("opens a file from the overview and publishes", async ({ page, server }) => {
    await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
    await expect(page.getByRole("button", { name: "Details" })).toBeVisible();
    // No decisions without the model; the host's threads are still there.
    await expect(page.locator("[data-slot=decision]")).toHaveCount(0);
    await expect(page.locator("[data-slot=review-thread]").first()).toBeVisible();

    // A click on the route's directory in the overview opens its first file in the map.
    // The rail has its own Tree · Overview switch; this is the page's layout switch.
    await page
      .getByRole("group", { name: "Layout" })
      .getByRole("button", { name: "Overview", exact: true })
      .click();
    const overview = page.getByRole("region", { name: "Overview of the changed files" });
    await overview.getByRole("button", { name: /^src\/routes\/, / }).click();
    await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("[data-slot=file-card]:focus")).toHaveAttribute(
      "aria-label",
      "src/routes/orders.ts",
    );

    // Without decisions, there's something to publish once there's a comment on a line.
    await expect(page.getByRole("button", { name: /^Publish review…/ })).toHaveCount(0);
    const changes = page.getByRole("region", { name: "Changes" });
    const number = changes.getByRole("button", { name: /^Comment on line \d+$/ }).first();
    const line = await number.textContent();
    await number.click();
    await changes.getByRole("textbox", { name: `Comment on line ${line}` }).fill("Why this?");
    await changes.getByRole("button", { name: /^Add to review/ }).click();

    await page.getByRole("button", { name: /^Publish review…/ }).click();
    const dialog = page.getByRole("dialog", { name: "Publish 1 comment" });
    await dialog.getByLabel("Summary").fill("One question.");
    await dialog.getByRole("button", { name: "Publish 1 comment" }).click();
    await expect(dialog).toBeHidden();
    const [attempt] = await publishAttempts(server);
    expect(attempt?.outcome).toBe("published");
    expect(attempt?.publication.verdict).toBe("comment");
    expect(attempt?.publication.summary).toBe("One question.");
    expect(attempt?.publication.comments.map((comment) => comment.body)).toEqual(["Why this?"]);
  });
});

for (const width of [720, 1024, 1440]) {
  test(`review stays within the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
    const overflows = () =>
      page.evaluate("document.documentElement.scrollWidth > window.innerWidth");
    expect(await overflows()).toBe(false);
    await expect(page.getByRole("button", { name: /^Publish review…/ })).toBeInViewport();
    // The rail has its own Tree · Overview switch; this is the page's layout switch.
    await page
      .getByRole("group", { name: "Layout" })
      .getByRole("button", { name: "Overview", exact: true })
      .click();
    await expect(page.locator("[data-slot=overview-scroll]")).toBeVisible();
    expect(await overflows()).toBe(false);
  });
}
