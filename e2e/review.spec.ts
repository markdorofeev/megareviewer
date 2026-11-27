import type { Locator, Page } from "@playwright/test";
import { z } from "zod";
import { expect, PR, publishAttempts, TOKEN, test } from "./fake-server.ts";

const SMALL_FEATURE_TITLE = "Add receipt download endpoint";

/** Opens the picker the way the CLI's link does. */
const openPicker = async (page: Page) => {
  await page.goto(`/?token=${TOKEN}`);
  await expect(page.getByRole("textbox", { name: "Pull request link" })).toBeVisible();
};

/** Asks Claude on the open review and waits until its passes are done. */
const analyzeWithClaude = async (page: Page) => {
  await page.getByRole("button", { name: "Request AI review" }).click();
  await expect(page.getByText(/^(From the code|Does what was asked):$/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Analysis progress" })).toBeHidden();
  await landed(page);
};

/** Waits until Claude's run has ended and its landing is done, so the page is at rest. */
const landed = async (page: Page) => {
  await expect(page.locator("[data-slot=model-hairline]")).toHaveCount(0);
  await expect(page.locator("[data-landing]")).toHaveAttribute("data-landing", "done");
};

/**
 * Analyzes a PR from its URL and waits until the review is complete, then, unless `claude` is
 * false, asks Claude on it and waits for that too.
 */
const openReview = async (page: Page, url: string, title: string, claude = true) => {
  await openPicker(page);
  await page.getByRole("textbox", { name: "Pull request link" }).fill(url);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page).toHaveURL(/\/review\/a_[0-9a-f]+(\?view=\w+)?$/);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  // The progress strip goes once the analysis is complete.
  await expect(page.getByRole("list", { name: "Analysis progress" })).toBeHidden();
  if (claude) await analyzeWithClaude(page);
};

/** The fake model's finding on a file: its card, and the folded line it becomes. */
const findingOn = (page: Page, path: string) => {
  const title = `Check ${path}`;
  return {
    card: page.getByRole("article", { name: title }),
    add: page.getByRole("button", { name: `Add to review: ${title}` }),
    edit: page.getByRole("button", { name: `Edit: ${title}` }),
    dismiss: page.getByRole("button", { name: `Dismiss: ${title}`, exact: true }),
  };
};

/** Clicks Add to review, Edit or Dismiss and waits until the server has the state. */
const act = async (page: Page, button: Locator, state: string) => {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/points/") && (response.request().postData() ?? "").includes(state),
  );
  await button.click();
  expect((await saved).ok()).toBe(true);
};

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

test("analyzes a PR from its URL, and asks Claude on it", async ({ page }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE, false);
  await expect(page.getByRole("button", { name: "Request AI review" })).toBeVisible();
  await analyzeWithClaude(page);
  await expect(page.getByRole("button", { name: "Request AI review" })).toHaveCount(0);
  await expect(page.getByText(/^(From the code|Does what was asked):$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Details", exact: true })).toBeVisible();
});

test("removes Claude's review in place, forgetting its points' states, and asks again", async ({
  page,
}) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  const config = findingOn(page, "config/app.yaml");
  await act(page, config.dismiss, "dismissed");
  const views: string[] = [];
  page.on("request", (request) => {
    if (/^\/api\/analyses\/a_[0-9a-f]+(\/events)?$/.test(new URL(request.url()).pathname)) {
      views.push(request.url());
    }
  });

  await page.getByRole("button", { name: "Remove AI review…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("button", { name: "Request AI review" })).toBeVisible();
  await expect(config.card).toHaveCount(0);
  await expect(page.locator("[data-slot=file-card]").first()).toBeVisible();
  // The page starts from what the removal answered, without loading the analysis again.
  expect(views).toEqual([]);

  await analyzeWithClaude(page);
  await expect(config.card).toHaveAttribute("data-state", "open");
});

test("analyzes a PR picked from the list", async ({ page }) => {
  await openPicker(page);
  await page.getByRole("link", { name: /Fix crash when refunding store-credit orders/ }).click();
  await expect(
    page.getByRole("heading", { name: "Fix crash when refunding store-credit orders", level: 1 }),
  ).toBeVisible();
  await analyzeWithClaude(page);
  await expect(page.getByRole("button", { name: /^Publish review…/ })).toBeEnabled();
});

test("the map shows the files in path order", async ({ page }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  const files = await page
    .locator("[aria-label=Changes] [data-slot=file-card]")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-label") ?? ""));
  // In path order, as a directory tree lists them.
  expect(files).toEqual(["config/app.yaml", "src/routes/orders.ts", "src/services/receipts.ts"]);
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
  // Scrolled to the bottom, the last line ends above room for a scrollbar drawn over the code,
  // as macOS draws it.
  const room = await scroller.evaluate((box) => {
    box.scrollTop = box.scrollHeight;
    const rows = box.querySelectorAll("[role=row]");
    const last = rows[rows.length - 1];
    if (last === undefined) return 0;
    return box.getBoundingClientRect().top + box.clientHeight - last.getBoundingClientRect().bottom;
  });
  expect(room).toBeGreaterThanOrEqual(10);
});

test("the line under the mouse shows a quiet plus on its number, which fills under it, an unchanged fold's doesn't", async ({
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
  const clear = "rgba(0, 0, 0, 0)";
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
  expect(await look(number)).toEqual({ plus: '"+"', fill: clear });
  expect(await tint(commentable)).toBe(clear);
  await number.hover();
  expect(await look(number)).toEqual({ plus: '"+"', fill: primary });
  expect(await tint(commentable)).toBe(clear);

  await card.locator("[data-slot=file-gap]").getByRole("button").first().click();
  const unchanged = card
    .locator("[role=row]")
    .filter({ hasNot: page.getByRole("button") })
    .first();
  await unchanged.hover();
  await expect(unchanged.getByRole("button")).toHaveCount(0);
  expect(await tint(unchanged)).toBe(clear);
  expect((await look(number)).plus).toBe("none");
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`the top line holds while Claude's cards open above it, ${reducedMotion} motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 1280, height: 480 });
    await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE, false);
    // Down to the last file, below the code the points rest on.
    await page
      .locator("[aria-label=Changes] [data-slot=file-card]")
      .last()
      .evaluate((card) =>
        window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY + 80),
      );
    const top = await page.evaluateHandle(() =>
      [...document.querySelectorAll("[aria-label=Changes] [role=row]")].find(
        (row) =>
          row.getBoundingClientRect().top >= 48 &&
          row.closest("[data-slot=file-card-header]") === null,
      ),
    );
    const topOf = () => top.evaluate((row) => row?.getBoundingClientRect().top ?? Number.NaN);
    const before = await topOf();
    expect(before).toBeGreaterThan(0);

    // Clicked where it is: a click that scrolls up to the button would move the window itself.
    await page.getByRole("button", { name: "Request AI review" }).dispatchEvent("click");
    await expect(page.locator("[data-slot=point]").first()).toBeAttached();
    await landed(page);
    // Cards opened above the line, and the line didn't move.
    const above = await page
      .locator("[data-slot=point]")
      .evaluateAll(
        (cards, line) => cards.filter((card) => card.getBoundingClientRect().bottom < line).length,
        before,
      );
    expect(above).toBeGreaterThan(0);
    expect(Math.abs((await topOf()) - before)).toBeLessThanOrEqual(1);
  });
}

test.describe("the bar, with many of Claude's points", () => {
  test.use({ scenario: "many" });

  test("is one row, stays in view, steps to a card below it, and publishes from there", async ({
    page,
  }) => {
    // The scenario plays Claude's run at its recorded pace, some 20 seconds.
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1024, height: 720 });
    await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE, false);
    await page.getByRole("button", { name: "Request AI review" }).click();
    await expect(page.locator("[data-slot=point-stepper]")).toBeVisible({ timeout: 60_000 });
    await landed(page);
    const bar = page.locator("[data-slot=review-bar]");

    // At 1024px every visible button sits on the bar's one row, and nothing scrolls sideways.
    const middles = await bar.getByRole("button").evaluateAll((buttons) =>
      buttons
        .map((button) => button.getBoundingClientRect())
        .filter((box) => box.width > 0)
        .map((box) => Math.round(box.top + box.height / 2)),
    );
    expect(Math.max(...middles) - Math.min(...middles)).toBeLessThanOrEqual(1);
    expect(await bar.evaluate((one) => one.getBoundingClientRect().height)).toBeLessThanOrEqual(53);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1024,
    );

    await page.setViewportSize({ width: 1280, height: 720 });
    // Start is where Next will be, and neither arrow moves from one step to the next: not when
    // the bar sticks as the first step scrolls the page, and not with the titles' lengths.
    const edges = (name: string) =>
      bar.getByRole("button", { name }).evaluate((one) => {
        const box = one.getBoundingClientRect();
        return [box.left, box.right];
      });
    const [, startRight] = await edges("Start");
    await bar.getByRole("button", { name: "Start" }).click();
    await expect(bar.getByRole("button", { name: /^Finding 1 of \d+, show all$/ })).toBeVisible();
    await expect(bar).toHaveAttribute("data-stuck", "true");
    expect((await bar.boundingBox())?.y).toBe(0);
    const previous = await edges("Previous finding");
    const next = await edges("Next finding");
    expect(next[1]).toBe(startRight);

    const card = page.locator("[data-slot=point]:focus");
    await expect(card).toBeInViewport();
    const barBottom = await bar.evaluate((one) => one.getBoundingClientRect().bottom);
    const cardTop = await card.evaluate((one) => one.getBoundingClientRect().top);
    expect(cardTop).toBeGreaterThanOrEqual(barBottom);
    // The lines the card rests on show above it, below the file's sticky header.
    const header = await card.evaluate(
      (one) =>
        one
          .closest("[data-slot=file-card]")
          ?.querySelector("[data-slot=file-card-header]")
          ?.getBoundingClientRect().bottom ?? Number.NaN,
    );
    expect(header).toBeLessThanOrEqual(cardTop);

    for (const step of [2, 3, 4]) {
      await bar.getByRole("button", { name: "Next finding" }).click();
      await expect(
        bar.getByRole("button", { name: new RegExp(`^Finding ${step} of \\d+, show all$`) }),
      ).toBeVisible();
      expect(await edges("Previous finding")).toEqual(previous);
      expect(await edges("Next finding")).toEqual(next);
    }

    // Stuck, it names the PR after the pager: from 1280px the bar keeps it 128px at least.
    await expect(bar).toHaveAttribute("data-stuck", "true");
    const title = bar.locator("[data-slot=bar-title]");
    await expect(title).toBeVisible();
    expect((await title.boundingBox())?.width).toBeGreaterThanOrEqual(128);
    await page.setViewportSize({ width: 1024, height: 720 });
    await expect(title).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 720 });

    await bar.getByRole("button", { name: /^Publish review…/ }).click();
    await expect(page.getByRole("dialog", { name: "Publish review" })).toBeVisible();
  });
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

test("raised and dismissed points persist across a reload", async ({ page }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  const config = findingOn(page, "config/app.yaml");
  const routes = findingOn(page, "src/routes/orders.ts");
  const changes = page.getByRole("region", { name: "Changes" });

  await act(page, config.dismiss, "dismissed");
  await act(page, routes.edit, "raised");
  await expect(changes.getByRole("textbox", { name: /^Comment on line/ })).toHaveValue(
    /Check src\/routes\/orders\.ts/,
  );
  await changes.getByRole("button", { name: "Add to review", exact: true }).click();

  await page.reload();
  await expect(config.card).toHaveAttribute("data-state", "dismissed");
  await expect(routes.card).toHaveAttribute("data-state", "raised");
  // The comment it opened is a draft in this browser until the review is published.
  await expect(changes.getByText(/Check src\/routes\/orders\.ts/).first()).toBeVisible();
});

test("publishes exactly what the preview shows, once, then approves in another review", async ({
  page,
  server,
}) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  await act(page, findingOn(page, "src/routes/orders.ts").edit, "raised");
  const changes = page.getByRole("region", { name: "Changes" });
  const field = changes.getByRole("textbox", { name: /^Comment on line/ });
  await field.fill("Scope this to the order's owner.");
  await changes.getByRole("button", { name: "Add to review", exact: true }).click();

  await page.getByRole("button", { name: /^Publish review…/ }).click();
  const dialog = page.getByRole("dialog", { name: "Publish review" });
  await expect(dialog.getByText(/^src\/routes\/orders\.ts:/)).toBeVisible();
  await dialog.getByRole("button", { name: "Request changes", exact: true }).click();
  await dialog.getByRole("button", { name: "Publish 1 comment and request changes" }).click();
  await expect(dialog).toBeHidden();
  // The bar says the reviewer's verdict, as the host now has it.
  await expect(page.locator("[data-slot=your-verdict]")).toHaveText("Changes requested");

  const [attempt, ...others] = await publishAttempts(server);
  expect(others).toEqual([]);
  expect(attempt?.outcome).toBe("published");
  expect(attempt?.publication.verdict).toBe("request_changes");
  expect(attempt?.publication.comments.map((comment) => comment.body)).toEqual([
    "Scope this to the order's owner.",
  ]);
  expect(attempt?.postedKeys).toEqual(["summary", ...(attempt?.postedKeys.slice(1) ?? [])]);

  // Line comments stay open once it's published: one can post now, as a thread of its own.
  const number = changes.getByRole("button", { name: /^Comment on line \d+$/ }).first();
  const line = await number.textContent();
  await number.click();
  await changes.getByRole("textbox", { name: `Comment on line ${line}` }).fill("One more.");
  await changes.getByRole("button", { name: "Comment now" }).click();
  await expect(
    changes
      .getByRole("article", { name: `Thread on line ${line}`, exact: true })
      .getByText("One more."),
  ).toBeVisible();

  // Once the author fixed it, the reviewer approves, in a review of its own.
  await page.getByRole("button", { name: /^Publish review…/ }).click();
  await expect(dialog.getByText(/^Your earlier review is on the pull request\./)).toBeVisible();
  await dialog.getByRole("button", { name: "Approve", exact: true }).click();
  await dialog.getByRole("button", { name: "Publish and approve" }).click();
  await expect(dialog).toBeHidden();
  const approval = (await publishAttempts(server)).at(-1);
  expect(approval?.publication.verdict).toBe("approve");
  expect(approval?.postedKeys).toEqual(["summary"]);
  expect(await publishAttempts(server)).toHaveLength(2);
});

test("a publish that fails part-way posts only the rest on retry", async ({ page, server }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  for (const path of ["config/app.yaml", "src/routes/orders.ts"]) {
    await act(page, findingOn(page, path).add, "raised");
  }
  // Post 1 is the summary, so the second inline comment is post 3.
  const armed = await server.request.post("/__fake/fail-publish-comment", { data: { n: 3 } });
  expect(armed.ok()).toBe(true);

  await page.getByRole("button", { name: /^Publish review…/ }).click();
  const dialog = page.getByRole("dialog", { name: "Publish review" });
  await dialog.getByRole("button", { name: "Publish 2 comments" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Retrying is safe");
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog).toBeHidden();

  const attempts = await publishAttempts(server);
  expect(attempts.map((attempt) => [attempt.outcome, attempt.postedKeys.length])).toEqual([
    ["failed", 2],
    ["published", 1],
  ]);
});

test("Claude's failure leaves the review, says why, and tries again", async ({ page }) => {
  await openReview(page, PR.intentFailsOnce, SMALL_FEATURE_TITLE, false);
  await page.getByRole("button", { name: "Request AI review" }).click();

  const failure = page.getByRole("alert").filter({ hasText: /missing:|couldn't finish/ });
  await expect(failure).toBeVisible();
  // The code's review is all there.
  await expect(page.locator("[data-slot=file-card]").first()).toBeVisible();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(failure).toBeHidden();
  await expect(page.getByText(/^(From the code|Does what was asked):$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Publish review…/ })).toBeEnabled();
});

test("a PR with new commits offers Re-analyze, publishing asks first, and Approve approves", async ({
  page,
  server,
}) => {
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
  const bar = page.locator("[data-slot=review-bar]");
  await expect(bar.getByRole("button", { name: "Re-analyze · new commits" })).toBeVisible();

  await page.getByRole("button", { name: /^Publish review…/ }).click();
  const dialog = page.getByRole("dialog", { name: "Publish review" });
  await dialog.getByRole("textbox", { name: "Summary" }).fill("One question.");
  await dialog.getByRole("button", { name: "Publish the summary" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Publish anyway?");
  expect(await publishAttempts(server)).toEqual([]);

  await dialog.getByRole("button", { name: "Publish anyway" }).click();
  await expect(dialog).toBeHidden();
  expect(await publishAttempts(server)).toHaveLength(1);

  await bar.getByRole("button", { name: "Approve" }).click();
  await expect(bar.getByRole("button", { name: "Revoke approval" })).toBeVisible();
  expect(await publishAttempts(server)).toHaveLength(2);
});

test("the header says where the PR stands, and its checks open and close with Esc", async ({
  page,
}) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  await expect(page.locator("[data-slot=pr-state]")).toHaveText("Open");
  await expect(page.locator("[data-slot=review-status]")).toHaveText("✕Changes requested");
  await expect(
    page.getByRole("button", { name: /^3 reviewers: 1 requested changes, 1 approved/ }),
  ).toBeVisible();

  const ci = page.getByRole("button", { name: "CI: 3 of 3 checks passed, show checks" });
  await ci.click();
  const checks = page.getByRole("list", { name: "Checks" });
  await expect(checks.getByRole("listitem")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(checks).toBeHidden();
  await expect(ci).toBeFocused();
});

test("replies to a thread and resolves it", async ({ page }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  const changes = page.getByRole("region", { name: "Changes" });

  const cache = changes.getByRole("article", { name: "Thread on line 4", exact: true });
  await expect(cache.getByText(/^This cache never evicts\./)).toBeVisible();
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

test("nothing in the bar overlaps, from a phone to 1280px, and it scrolls sideways only below 768px", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  const bar = page.locator("[data-slot=review-bar]");
  const chip = bar.locator("[data-slot=thread-chip]");

  /** The bar's visible controls by their left edge, outermost only, and its widths. */
  const measure = () =>
    bar.evaluate((one) => {
      const all = [
        ...one.querySelectorAll<HTMLElement>("button, a, [data-slot=your-verdict]"),
      ].filter((control) => {
        const box = control.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(control).visibility !== "hidden";
      });
      const outer = all.filter(
        (control) => !all.some((other) => other !== control && other.contains(control)),
      );
      const controls = outer
        .map((control) => {
          const box = control.getBoundingClientRect();
          const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
          return { name: name.trim().slice(0, 40), left: box.left, right: box.right };
        })
        .sort((a, b) => a.left - b.left);
      return { controls, scrollWidth: one.scrollWidth, clientWidth: one.clientWidth };
    });

  const check = async (state: string) => {
    for (const width of [375, 480, 640, 720, 768, 900, 1024, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      // Two frames, so the layout has followed the resize.
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const { controls, scrollWidth, clientWidth } = await measure();
      for (const [n, control] of controls.entries()) {
        const before = controls[n - 1];
        if (before === undefined) continue;
        expect(
          control.left,
          `${state} at ${width}px: "${control.name}" starts under "${before.name}"`,
        ).toBeGreaterThanOrEqual(before.right - 1);
      }
      if (width >= 640) {
        expect(scrollWidth, `${state} at ${width}px: the bar scrolls`).toBeLessThanOrEqual(
          clientWidth,
        );
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${state} at ${width}px: the page scrolls sideways`,
      ).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  };

  await expect(bar.locator("[data-slot=point-stepper]")).toBeVisible();
  await check("findings, before the first step");
  // The chip has the pager walk the threads, from the first.
  await chip.click();
  await expect(bar.getByRole("button", { name: /^Thread 1 of \d+, show all$/ })).toBeVisible();
  await check("threads, on a step");
  await chip.click();
  await bar.getByRole("button", { name: "Start" }).click();
  await expect(bar.getByRole("button", { name: /^Finding 1 of \d+, show all$/ })).toBeVisible();
  await check("findings, on a step");
});

test("walks the threads from the bar, before Claude runs and beside its findings", async ({
  page,
}) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE, false);
  const bar = page.locator("[data-slot=review-bar]");
  const position = bar.getByRole("button", { name: /, show all$/ });
  await expect(position).toContainText("5 unresolved");

  // The keyboard steps as the mouse does.
  await bar.getByRole("button", { name: "Start" }).focus();
  await page.keyboard.press("Enter");
  await expect(position).toHaveAccessibleName("Thread 1 of 5, show all");
  await expect(bar.getByRole("status")).toHaveText(
    /^Thread 1 of 5, src\/routes\/orders\.ts line 39: Sam Ortiz: Say the charset/,
  );
  const thread = page.locator("[data-slot=review-thread]:focus");
  await expect(thread).toHaveAttribute("id", /^thread-/);
  await expect(thread).toBeInViewport();
  // Under the bar, and under its file's sticky header.
  const barBottom = await bar.evaluate((one) => one.getBoundingClientRect().bottom);
  const header = await thread.evaluate(
    (one) =>
      one
        .closest("[data-slot=file-card]")
        ?.querySelector("[data-slot=file-card-header]")
        ?.getBoundingClientRect().bottom ?? Number.NaN,
  );
  const top = await thread.evaluate((one) => one.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(Math.max(barBottom, header));

  // Round all five, top to bottom of the page, and back to the first.
  const tops: number[] = [];
  for (let n = 2; n <= 6; n += 1) {
    await bar.getByRole("button", { name: "Next thread" }).click();
    const at = page.locator("[data-slot=review-thread]:focus");
    await expect(at).toBeInViewport();
    tops.push(await at.evaluate((one) => one.getBoundingClientRect().top + window.scrollY));
  }
  await expect(position).toHaveText("1 of 5");
  expect(tops.slice(0, 4)).toEqual([...tops.slice(0, 4)].sort((a, b) => a - b));

  // The list has the unresolved threads only.
  await position.click();
  const list = page.getByRole("dialog", { name: "5 unresolved threads" });
  await expect(list.getByRole("button", { name: /Why ten times the rate limit\?/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();

  // With Claude's findings, the threads are a chip after the pager. The pager stays on the
  // threads the reviewer was going round; the chip takes it to the findings and back.
  await analyzeWithClaude(page);
  const chip = bar.getByRole("button", { name: "5 unresolved threads" });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await chip.click();
  await expect(bar.getByRole("button", { name: /^\d+ findings?, show all$/ })).toBeVisible();
  await chip.click();
  // Back on the threads, the stepper is where it was.
  await expect(position).toHaveAccessibleName("Thread 1 of 5, show all");
  await bar.getByRole("button", { name: "Next thread" }).click();
  await expect(position).toHaveAccessibleName("Thread 2 of 5, show all");
  await expect(page.locator("[data-slot=review-thread]:focus")).toBeInViewport();
});

/** The middle of a stretch of a line's text, on the screen. */
const textAt = (row: Locator, text: string, edge: "start" | "end") =>
  row.locator("[data-slot=line-code]").evaluate(
    (cell, [wanted, side]) => {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(wanted) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + wanted.length);
        const box = range.getBoundingClientRect();
        return {
          x: side === "start" ? box.left + 1 : box.right - 1,
          y: (box.top + box.bottom) / 2,
        };
      }
      throw new Error(`no text ${wanted}`);
    },
    [text, edge] as const,
  );

/** Drags from one point to another, in steps, as a hand does. */
const drag = async (
  page: Page,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  release = true,
) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  if (release) await page.mouse.up();
};

const middle = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("not on the screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("opens the comment box from a line's number or a drag down the numbers, and not from the code", async ({
  page,
}) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE, false);
  const changes = page.getByRole("region", { name: "Changes" });
  const field = changes.getByRole("textbox", { name: /^Comment on/ });
  const receipts = changes.locator('[data-slot=file-card][data-path="src/services/receipts.ts"]');
  const line = (number: number) => receipts.locator(`[data-place="new:${number}"]`);
  const number = (of: number) =>
    receipts.getByRole("button", { name: `Comment on line ${of}`, exact: true });
  await line(9).scrollIntoViewIfNeeded();

  // The code is text: a click on it opens nothing, and the row under the mouse keeps its colors.
  await line(9).locator("[data-slot=line-code]").click();
  await expect(field).toHaveCount(0);
  const cell = () => number(9).evaluate((one) => getComputedStyle(one).backgroundColor);
  await expect(line(9)).toHaveCSS("cursor", "auto");
  expect(await cell()).toBe("rgba(0, 0, 0, 0)");
  expect(await number(9).evaluate((one) => getComputedStyle(one, "::before").content)).toBe('"+"');
  await number(9).hover();
  expect(await cell()).not.toBe("rgba(0, 0, 0, 0)");

  await number(9).click();
  await expect(changes.getByRole("textbox", { name: "Comment on line 9" })).toBeFocused();
  // A click on the line of an open box leaves it open; on its number, closes it.
  await line(9).locator("[data-slot=line-code]").click();
  await expect(field).toHaveCount(1);
  await number(9).click();
  await expect(field).toHaveCount(0);

  await drag(page, await middle(number(9)), await middle(number(11)), false);
  await expect(receipts.locator("[data-marked]")).toHaveCount(3);
  expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
  await page.mouse.up();
  await expect(changes.getByRole("textbox", { name: "Comment on lines 9–11" })).toBeFocused();
  await expect(receipts.locator("[data-marked]")).toHaveCount(3);
});

test("offers to comment on a selection of code, at its end", async ({ page }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE, false);
  const changes = page.getByRole("region", { name: "Changes" });
  const config = changes.locator('[data-slot=file-card][data-path="config/app.yaml"]');
  const line = (place: string) => config.locator(`[data-place="${place}"]`);
  const button = page.locator("[data-slot=selection-comment]");
  await line("new:14").scrollIntoViewIfNeeded();

  // From an unchanged line over a deleted and an added one: the added line's side.
  await drag(
    page,
    await textAt(line("new:12"), "enabled", "start"),
    await textAt(line("new:13"), "perMinute", "end"),
    false,
  );
  await expect(button).toHaveCount(0);
  await page.mouse.up();
  await expect(button).toBeVisible();
  const [end, box] = [await line("new:13").boundingBox(), await button.boundingBox()];
  if (end === null || box === null) throw new Error("not on the screen");
  expect(box.y).toBeGreaterThan(end.y);
  expect(box.y - (end.y + end.height)).toBeLessThan(8);

  // Esc puts it away and leaves the selection; a click in the code clears both.
  await page.keyboard.press("Escape");
  await expect(button).toHaveCount(0);
  await line("new:16").locator("[data-slot=line-code]").click();
  await expect(changes.getByRole("textbox", { name: /^Comment on/ })).toHaveCount(0);

  // Upwards, ending on the deleted line: its side, with the button above it.
  await drag(
    page,
    await textAt(line("new:13"), "perMinute", "end"),
    await textAt(line("old:13"), "perMinute", "start"),
  );
  await expect(button).toBeVisible();
  const deleted = await line("old:13").boundingBox();
  const above = await button.boundingBox();
  if (deleted === null || above === null) throw new Error("not on the screen");
  expect(above.y + above.height).toBeLessThanOrEqual(deleted.y + 4);

  // Out of sight under the bar it's away, and back with the line.
  await page.evaluate(() => window.scrollBy({ top: 400, behavior: "instant" }));
  await expect(button).toBeHidden();
  await page.evaluate(() => window.scrollBy({ top: -400, behavior: "instant" }));
  await expect(button).toBeVisible();

  await button.click();
  await expect(changes.getByRole("textbox", { name: "Comment on old line 13" })).toBeFocused();
  await expect(button).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await page.keyboard.press("Escape");

  // A triple click selects the line, and only it.
  const at = await textAt(line("new:14"), "burst", "start");
  await page.mouse.click(at.x, at.y, { clickCount: 3 });
  await expect(button).toBeVisible();
  await button.click();
  await expect(changes.getByRole("textbox", { name: "Comment on line 14" })).toBeFocused();
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

test("says on a finding which check could catch it, and adds it to the comment made from it", async ({
  page,
}) => {
  await openReview(page, PR.receiptsChecked, `${SMALL_FEATURE_TITLE}, in a repository with Biome`);
  const changes = page.getByRole("region", { name: "Changes" });
  const rule =
    "A check could catch this: noMisusedPromises in Biome, which biome.json doesn't turn on.";

  // The run's guardrail call marks Claude's finding after the review has landed. With the card
  // above the window, the line it adds doesn't move the code being read.
  const finding = changes.locator("[data-slot=point]");
  await expect(finding.locator("[data-slot=guardrail]")).toHaveCount(0);
  await page.evaluate(() => {
    const card = document.querySelector("[data-slot=point]");
    if (card === null) throw new Error("no finding");
    window.scrollBy({ top: card.getBoundingClientRect().bottom + 40, behavior: "instant" });
  });
  // The bar sticks once the page has scrolled, before anything is measured.
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => {
    const reading = document.elementFromPoint(400, 260);
    if (reading === null) throw new Error("nothing under the point");
    reading.setAttribute("data-reading", "");
    return reading.getBoundingClientRect().top;
  });
  await expect(finding.locator("[data-slot=guardrail]")).toHaveText(rule);
  const after = await page
    .locator("[data-reading]")
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThan(1);
  await expect(page.locator("[data-slot=repeated-chip]")).toHaveCount(0);

  // The draft Add to review makes from it says the same, and adds the check to its words.
  await finding.getByRole("button", { name: "Add to review" }).click();
  const draft = changes.locator("[data-slot=draft-guardrail]");
  await expect(draft.locator("[data-slot=guardrail]")).toContainText(rule);
  await draft.getByRole("button", { name: "Add to comment" }).click();
  await expect(draft.getByText("Added to the comment")).toBeVisible();
  await expect(changes.locator("[data-slot=line-comment]")).toContainText(
    "A check could catch this next time: noMisusedPromises in Biome.",
  );
});

test("ranks findings by severity, says each one's type and narrows the pager to one", async ({
  page,
}) => {
  await openReview(page, PR.receiptsTyped, `${SMALL_FEATURE_TITLE}, with a finding of each type`);
  const bar = page.locator("[data-slot=review-bar]");
  const title = bar.locator("[data-slot=stepper-title]");
  const position = bar.getByRole("button", { name: /, show all$/ });
  const next = bar.getByRole("button", { name: "Next finding" });
  await expect(position).toHaveAccessibleName("3 findings, show all");
  await bar.getByRole("button", { name: "Start" }).click();
  await expect(title).toHaveText("■Any client can send ten times the requests");
  const card = page.getByRole("article", { name: "Any client can send ten times the requests" });
  await expect(card.locator("[data-slot=finding-type]")).toHaveText(/contract/);
  await expect(card.locator("[data-slot=severity]")).toHaveText(/blocking/);
  await expect(page.locator("[data-point-mark=blocking]")).toHaveCount(1);
  await next.click();
  await expect(title).toHaveText(/Formats prices beside the code that already does$/);
  await next.click();
  await expect(title).toHaveText(/Receipts are never removed from memory$/);

  // A type is picked in the list, which narrows what the arrows walk without moving the page.
  const settled = async () => {
    let last = Number.NaN;
    await expect
      .poll(async () => {
        const now = await page.evaluate(() => window.scrollY);
        const still = now === last;
        last = now;
        return still;
      })
      .toBe(true);
    return last;
  };
  await settled();
  await position.click();
  const list = page.getByRole("dialog", { name: "3 findings from Claude" });
  const scrolled = await settled();
  await list.getByRole("button", { name: "≡ architecture 1" }).click();
  await expect(list.getByRole("list", { name: "Findings" }).getByRole("listitem")).toHaveCount(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(position).toBeFocused();
  await next.click();
  await expect(title).toHaveText(/Formats prices beside the code that already does$/);
  await expect(position).toHaveAccessibleName("Architecture finding 1 of 1, show all");
  await expect(position).toHaveText("1 of 1 architecture");
  await position.click();
  await list.getByRole("button", { name: "All 3" }).click();
  await expect(position).toHaveAccessibleName("Finding 2 of 3, show all");
});

/** Turns on the Display menu's Overview switch, off by default, before the page loads. */
const withOverview = (page: Page) =>
  page.addInitScript(() => window.localStorage.setItem("megareviewer:overview", "true"));

test.describe("without the model", () => {
  test.use({ ai: false });

  test("opens a file from the overview and publishes", async ({ page, server }) => {
    await withOverview(page);
    await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE, false);
    await expect(page.getByRole("button", { name: "Details", exact: true })).toBeVisible();
    // No points without the model; the host's threads are still there.
    await expect(page.locator("[data-slot=point]")).toHaveCount(0);
    await expect(page.locator("[data-slot=review-thread]").first()).toBeVisible();

    // A click on the route's directory in the overview opens its first file in the map.
    await page
      .getByRole("group", { name: "Layout" })
      .getByRole("button", { name: "Overview" })
      .click();
    const overview = page.getByRole("region", { name: "Overview of the changed files" });
    await overview.getByRole("button", { name: /^src\/routes\/, / }).click();
    await expect(page.locator("[data-slot=review-page]")).toHaveAttribute("data-layout", "map");
    await expect(page.locator("[data-slot=file-card]:focus")).toHaveAttribute(
      "aria-label",
      "src/routes/orders.ts",
    );

    // The verdict is the reviewer's own, so Publish is there with or without a comment.
    await expect(page.getByRole("button", { name: /^Publish review…/ })).toBeVisible();
    const changes = page.getByRole("region", { name: "Changes" });
    const number = changes.getByRole("button", { name: /^Comment on line \d+$/ }).first();
    const line = await number.textContent();
    await number.click();
    await changes.getByRole("textbox", { name: `Comment on line ${line}` }).fill("Why this?");
    await changes.getByRole("button", { name: "Add to review", exact: true }).click();

    await page.getByRole("button", { name: /^Publish review…/ }).click();
    const dialog = page.getByRole("dialog", { name: "Publish review" });
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

const FLOW_FORMS = [
  { name: "Lanes", region: "Flow paths of the pull request, by directory" },
  {
    name: "Bow tie",
    region: "Where the change is reached, what it runs through and what it ends in",
  },
  { name: "Flow rows", region: "Flow paths of the pull request" },
] as const;

/** Shows the overview in one of its preview forms, from the Display menu. */
const showForm = async (page: Page, form: (typeof FLOW_FORMS)[number]) => {
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("menuitemradio", { name: form.name, exact: true }).click();
  // The menu stays open, to compare the forms.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  return page.getByRole("region", { name: form.region, exact: true });
};

test("shows the overview in each preview form, whose stops open the map", async ({ page }) => {
  await withOverview(page);
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE, false);
  await page
    .getByRole("group", { name: "Layout" })
    .getByRole("button", { name: "Overview" })
    .click();
  for (const form of FLOW_FORMS) {
    const view = await showForm(page, form);
    const stop = view.getByRole("button", { name: /^receipts, / }).first();
    await expect(stop).toBeVisible();
    await expect(view.getByRole("region", { name: "Also changed" })).toContainText("app.yaml");
    await stop.click();
    const review = page.locator("[data-slot=review-page]");
    await expect(review).toHaveAttribute("data-layout", "map");
    await page.keyboard.press("Escape");
    await expect(review).toHaveAttribute("data-layout", "overview");
    await expect(stop).toBeFocused();
  }
});

for (const width of [375, 768, 1024]) {
  test(`the overview's preview forms stay within the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await withOverview(page);
    await page.addInitScript(() =>
      window.localStorage.setItem("megareviewer:review-layout", '"overview"'),
    );
    await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE, false);
    for (const form of FLOW_FORMS) {
      const view = await showForm(page, form);
      await expect(view.getByRole("button", { name: /^receipts, / }).first()).toBeVisible();
      expect(
        await page.evaluate("document.documentElement.scrollWidth > window.innerWidth"),
        form.name,
      ).toBe(false);
    }
  });
}

for (const width of [720, 1024, 1440]) {
  test(`review stays within the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await withOverview(page);
    await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
    const overflows = () =>
      page.evaluate("document.documentElement.scrollWidth > window.innerWidth");
    expect(await overflows()).toBe(false);
    await expect(page.getByRole("button", { name: /^Publish review…/ })).toBeInViewport();
    await page
      .getByRole("group", { name: "Layout" })
      .getByRole("button", { name: "Overview" })
      .click();
    await expect(page.locator("[data-slot=overview-scroll]")).toBeVisible();
    expect(await overflows()).toBe(false);
  });
}

/** Six long comments, with code, a long unbroken token and suggestions, on receipts.ts's lines. */
const longComments = () => {
  const code = Array.from(
    { length: 12 },
    (_, n) => `const receipt${n} = await renderReceipt(order, { currency: "EUR", taxes: true });`,
  );
  const prose =
    "This cache keeps rendered receipts for an hour, but a refund in the meantime leaves the " +
    "customer a receipt that still shows the full amount. ";
  return [1, 2, 3, 4, 5, 6].map((line) => ({
    hunkId: "h_a2e0236601ffc778",
    side: "new",
    line,
    body: `${prose.repeat(3)}See https://example.com/${"receipts/".repeat(20)}\n\n\`\`\`ts\n${code.join("\n")}\n\`\`\``,
    ...(line % 2 === 0 ? { suggestion: ["const RECEIPT_TTL_MS = 5 * 60 * 1000;"] } : {}),
  }));
};

for (const [size, viewport] of [
  ["1440×900", { width: 1440, height: 900 }],
  ["a short window", { width: 1280, height: 700 }],
  ["phone width", { width: 390, height: 844 }],
  ["200% zoom", { width: 720, height: 450 }],
] as const) {
  test(`the publish dialog fits ${size}, its comments scrolling inside it`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE, false);
    const analysisId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
      `megareviewer:hunk-comments:${analysisId}`,
      JSON.stringify(longComments()),
    ] as const);
    await page.reload();
    await page.getByRole("button", { name: /^Publish review…/ }).click();

    const dialog = page.getByRole("dialog");
    const comments = dialog.getByRole("list", { name: "Comments" });
    await expect(comments.getByRole("listitem")).toHaveCount(6);
    // All but the comments is in view at once, without scrolling the dialog.
    for (const control of [
      dialog.getByRole("group", { name: "Verdict" }),
      dialog.getByRole("textbox", { name: "Summary" }),
      dialog.getByRole("button", { name: /^Publish|^Approve|^Request changes/ }).last(),
    ]) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    // The comments scroll inside it, and nothing scrolls sideways.
    const scroller = await comments.evaluate((list) => {
      for (let box: Element | null = list; box !== null; box = box.parentElement) {
        if (box.scrollHeight > box.clientHeight)
          return box.getAttribute("data-slot") ?? box.tagName;
      }
      return null;
    });
    expect(scroller, "what scrolls").toBe("publish-comments");
    expect(
      await dialog.evaluate((box) => box.scrollWidth <= box.clientWidth),
      "nothing is wider than the dialog",
    ).toBe(true);
    const box = await dialog.boundingBox();
    expect(box !== null && box.y >= 0 && box.y + box.height <= viewport.height).toBe(true);

    // The focus stays inside, and reaches the comments, so the keyboard can scroll them.
    let reachedComments = false;
    for (let n = 0; n < 12; n += 1) {
      await page.keyboard.press("Tab");
      // Wrapping round from the last stop passes through a guard that hands the focus on.
      await expect
        .poll(() => dialog.evaluate((box) => box.contains(document.activeElement)))
        .toBe(true);
      reachedComments ||= await comments.evaluate(
        (list) => document.activeElement?.contains(list) === true,
      );
    }
    expect(reachedComments, "the comments take the focus").toBe(true);
  });
}
