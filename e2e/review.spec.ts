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
  await expect(page.getByRole("button", { name: "Publish…" })).toBeEnabled();
};

/** How many hunks and parts this browser has marked reviewed. */
const reviewedCount = async (page: Page) =>
  z
    .array(z.string())
    .parse(
      JSON.parse(
        (await page.evaluate(() => localStorage.getItem("megareviewer:reviewed-hunks"))) ?? "[]",
      ),
    ).length;

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

const rail = (page: Page) => page.getByRole("complementary", { name: "Map" });

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
  await expect(page.getByRole("button", { name: "Publish…" })).toBeEnabled();
});

test("the map moves through the hunks and the steps with the keyboard", async ({ page }) => {
  await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
  // j and k move the focus between the cards of a step, n to the next step.
  const labelsIn = (step: number) =>
    page
      .locator(".map-step")
      .nth(step)
      .locator(".hunk-card")
      .evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-label") ?? ""));
  const [first, second] = await labelsIn(0);
  const [next] = await labelsIn(1);
  if (first === undefined || second === undefined || next === undefined) {
    throw new Error("expected two cards in the first step and one in the second");
  }
  const focused = page.locator(".hunk-card:focus");
  await page.keyboard.press("j");
  await expect(focused).toHaveAttribute("aria-label", first);
  await page.keyboard.press("j");
  await expect(focused).toHaveAttribute("aria-label", second);
  await page.keyboard.press("k");
  await expect(focused).toHaveAttribute("aria-label", first);

  await page.keyboard.press("n");
  await page.keyboard.press("j");
  await expect(focused).toHaveAttribute("aria-label", next);
  await expect(rail(page).locator(".rail-hunk.in-view").first()).toBeVisible();
});

test("mechanical changes are collapsed until expanded", async ({ page }) => {
  await openReview(page, PR.refactorMove, "Tidy up utilities");
  await rail(page)
    .getByRole("button", { name: /^Proved mechanical/ })
    .click();
  const group = page.getByRole("region", { name: /Mechanical changes/ });
  const toggles = group.getByRole("button", { expanded: false });
  await expect(toggles.first()).toBeVisible();
  await expect(group.locator(".hunk-card")).toHaveCount(0);

  await toggles.first().click();
  await expect(group.getByRole("button", { expanded: true })).toHaveCount(1);
  await expect(group.locator(".hunk-card")).toHaveCount(1);
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

  await page.getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish the review" });
  await expect(dialog.getByText("Request changes", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "1 inline comment" })).toBeVisible();
  await expect(dialog.getByText("src/routes/orders.ts:")).toBeVisible();
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
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

  await page.getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish the review" });
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "Publish…" })).toBeEnabled();
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

  await page.getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish the review" });
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Publish anyway?");
  expect(await publishAttempts(server)).toEqual([]);

  await dialog.getByRole("button", { name: "Publish anyway" }).click();
  await expect(dialog).toBeHidden();
  expect(await publishAttempts(server)).toHaveLength(1);
});

test.describe("without the model", () => {
  test.use({ ai: false });

  test("reviews along the calls, opens a file from the overview, jumps with ⌘K and publishes", async ({
    page,
    server,
  }) => {
    await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
    await expect(page.getByRole("button", { name: "Details" })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);

    // In the map, the receipt route's call, the symbol in its code, opens the receipt service in
    // place.
    const route = page.getByRole("region", { name: /^src\/routes\/orders\.ts, lines 29–/ });
    const call = route.locator(".call-link", { hasText: /^renderReceipt$/ });
    await call.click();
    await expect(call).toHaveAttribute("aria-expanded", "true");
    const opened = route.locator(".inline-call");
    await opened.getByRole("checkbox", { name: "Reviewed" }).check();
    await expect.poll(() => reviewedCount(page)).toBe(1);

    // The overview ticks the receipt service's file; a click on the route's file opens its code.
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    const overview = page.getByRole("region", { name: "Overview of the changed files" });
    await expect(
      overview.getByRole("button", { name: /^receipts\.ts, .*, reviewed$/ }),
    ).toBeVisible();
    await overview.getByRole("button", { name: /^orders\.ts, / }).click();
    await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".hunk-card:focus")).toHaveAttribute(
      "aria-label",
      /^src\/routes\/orders\.ts/,
    );
    await page.keyboard.press("x");
    await expect.poll(() => reviewedCount(page)).toBe(2);

    // ⌘K with ! lists the contract changes; Enter goes to the first.
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Jump to" });
    await palette.getByRole("searchbox", { name: "Jump to" }).fill("!");
    await expect(palette.getByRole("region", { name: "Contract changes" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(page.locator(".hunk-card.risk-contract:focus")).toHaveCount(1);

    await page.getByRole("button", { name: "Publish…" }).click();
    const dialog = page.getByRole("dialog", { name: "Publish the review" });
    await dialog.getByRole("radio", { name: "Approve" }).check();
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(dialog).toBeHidden();
    const [attempt] = await publishAttempts(server);
    expect(attempt?.outcome).toBe("published");
    expect(attempt?.publication.verdict).toBe("approve");
  });
});

for (const width of [720, 1024, 1440]) {
  test(`review stays within the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openReview(page, PR.smallFeature, SMALL_FEATURE_TITLE);
    const overflows = () =>
      page.evaluate("document.documentElement.scrollWidth > window.innerWidth");
    expect(await overflows()).toBe(false);
    await expect(page.getByRole("button", { name: "Publish…" })).toBeInViewport();
    await expect(page.getByRole("button", { name: /^Jump to/ })).toBeInViewport();
    if (width <= 1024) {
      await expect(rail(page)).toBeHidden();
      await page.getByRole("button", { name: "Show Map" }).click();
      await expect(rail(page)).toBeVisible();
      expect(await overflows()).toBe(false);
      await page.getByRole("button", { name: "Hide Map" }).click();
    }
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(page.locator(".overview-scroll")).toBeVisible();
    expect(await overflows()).toBe(false);
  });
}
