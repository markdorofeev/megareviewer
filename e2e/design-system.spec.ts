// Code passed to page.evaluate runs in the browser, so it needs the DOM's types.
/// <reference lib="dom" />
import { expect, type Page, test } from "@playwright/test";
import { focusProblems, pageProblems, unnamedControls } from "./a11y.ts";

// The design-system preview, /design-system.html, in the four theme combinations it supports.

const COMBINATIONS = [
  { name: "light", theme: "light", palette: "default" },
  { name: "dark", theme: "dark", palette: "default" },
  { name: "cb-light", theme: "light", palette: "cb" },
  { name: "cb-dark", theme: "dark", palette: "cb" },
] as const;

type Combination = (typeof COMBINATIONS)[number];

const open = async (page: Page, { theme, palette }: Pick<Combination, "theme" | "palette">) => {
  await page.addInitScript(
    ([storedTheme, storedPalette]) => {
      window.localStorage.setItem("megareviewer:theme", JSON.stringify(storedTheme));
      window.localStorage.setItem("megareviewer:diffPalette", JSON.stringify(storedPalette));
    },
    [theme, palette],
  );
  await page.goto("/design-system.html");
  await expect(page.getByRole("heading", { name: "Screens", level: 2 })).toBeVisible();
  // Fonts and syntax colors arrive after the first paint.
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".text-syntax-keyword").first()).toBeVisible();
  // Nothing is mid-landing, so screenshots are of the page at rest.
  await expect(page.locator('[data-landing]:not([data-landing="done"])')).toHaveCount(0);
};

for (const combination of COMBINATIONS) {
  test(`meets the accessibility checks, ${combination.name}`, async ({ page }) => {
    await open(page, combination);
    const html = page.locator("html");
    await expect(html).toHaveClass(combination.theme === "dark" ? "dark" : "");
    const focus = await focusProblems(page);
    expect([
      ...(await unnamedControls(page)),
      ...(await pageProblems(page)),
      ...focus.problems,
    ]).toEqual([]);
    // The walk reached the end of the page, not just its first controls.
    expect(focus.stops).toBeGreaterThan(150);
  });

  test(`looks as it did, ${combination.name}`, async ({ page }) => {
    // Fonts render differently on each platform; the baselines are macOS's, checked by CI's
    // macOS job.
    test.skip(process.platform !== "darwin", "baselines are macOS screenshots");
    await open(page, combination);
    for (const section of ["foundations", "screens"]) {
      await expect(page.locator(`#${section}`)).toHaveScreenshot(
        `${section}-${combination.name}.png`,
      );
    }
  });
}

for (const combination of COMBINATIONS) {
  test(`opens the choice of model, a disabled option focusable with why, ${combination.name}`, async ({
    page,
  }) => {
    await open(page, combination);
    await page.getByRole("button", { name: "Model: Sonnet 5.5" }).first().click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitemradio")).toHaveCount(6);
    // The last option is the API's Opus, which can't run without credentials.
    await page.keyboard.press("End");
    const focused = menu.locator(":focus");
    await expect(focused).toHaveAttribute("aria-disabled", "true");
    await expect(focused).toHaveAccessibleDescription(/^No Anthropic API credentials/);
    expect(await pageProblems(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });
}

test("works from the keyboard", async ({ page }) => {
  await open(page, { theme: "light", palette: "default" });
  const screens = page.locator("#screens");
  const grid = screens.getByRole("grid").nth(1);
  const focused = () =>
    grid.evaluate(
      (element) =>
        document.getElementById(element.getAttribute("aria-activedescendant") ?? "")?.textContent ??
        "",
    );
  const selected = grid.locator("[aria-selected=true]");

  // ↑ ↓ move the line focus; with ⇧ they select.
  await grid.focus();
  expect(await focused()).toContain("unchanged line 15");
  await page.keyboard.press("ArrowDown");
  expect(await focused()).toContain("unchanged line 16");
  await expect(selected).toHaveCount(0);
  await page.keyboard.press("Shift+ArrowUp");
  await expect(selected).toHaveCount(2);

  // c comments on the selection; ⌘↵ sends it.
  await page.keyboard.press("c");
  const composer = screens.getByRole("textbox", { name: "Comment on src/http/retry.ts:15–16" });
  await expect(composer).toBeFocused();
  await page.keyboard.type("Typed from the keyboard.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(screens.getByText("Typed from the keyboard.")).toBeVisible();
  await expect(composer).toHaveCount(0);

  // u switches the diff between unified and split.
  await grid.focus();
  await page.keyboard.press("u");
  await expect(screens.getByRole("button", { name: "Split" }).nth(1)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("u");
  await expect(screens.getByRole("button", { name: "Unified" }).nth(1)).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // n and p move through the overview's files.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const active = screens.locator("nav [aria-current]");
  await expect(active).toHaveAttribute("title", "src/http/retry.ts");
  await page.keyboard.press("n");
  await expect(active).toHaveAttribute("title", "src/util/sleep.ts");
  await page.keyboard.press("p");
  await expect(active).toHaveAttribute("title", "src/http/retry.ts");

  // / filters the files; Esc clears the filter.
  await page.keyboard.press("/");
  const filter = page.getByRole("searchbox", { name: "Filter files" }).first();
  await expect(filter).toBeFocused();
  await page.keyboard.type("sleep");
  await page.keyboard.press("Escape");
  await expect(filter).toHaveValue("");

  // ⇧R opens the review to publish; Esc closes it.
  await filter.blur();
  await page.keyboard.press("Shift+R");
  const publish = page.getByRole("dialog", { name: "Publish review" });
  await expect(publish).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(publish).toHaveCount(0);

  // ? lists the shortcuts, and turns the letter keys off.
  await page.keyboard.press("?");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcuts).toBeVisible();
  await shortcuts.getByRole("switch", { name: /Single-key shortcuts/ }).click();
  await page.keyboard.press("Escape");
  await expect(shortcuts).toHaveCount(0);
  await page.keyboard.press("n");
  await expect(active).toHaveAttribute("title", "src/http/retry.ts");
});

test("stops motion when the reader asks for less", async ({ page }) => {
  const durations = () =>
    page.evaluate(() => {
      const toggle = document.querySelector("[data-slot=toggle-group-item]");
      const skeleton = document.querySelector("[data-slot=skeleton]");
      if (toggle === null || skeleton === null) throw new Error("no toggle or skeleton");
      return {
        transition: getComputedStyle(toggle).transitionDuration,
        animation: getComputedStyle(skeleton).animationDuration,
      };
    });
  await open(page, { theme: "light", palette: "default" });
  expect(await durations()).not.toEqual({ transition: "0s", animation: "0s" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await durations()).toEqual({ transition: "0s", animation: "0s" });
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`Play runs Claude's landing, ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await open(page, { theme: "light", palette: "default" });
    const demo = page
      .locator("[data-landing]")
      .filter({ has: page.getByRole("button", { name: "Play" }) });
    await demo.evaluate((root) => {
      const seen: string[] = [];
      new MutationObserver(() => seen.push(root.getAttribute("data-landing") ?? "")).observe(root, {
        attributes: true,
        attributeFilter: ["data-landing"],
      });
      Object.assign(window, { landingPhases: seen });
    });
    await demo.getByRole("button", { name: "Play" }).click();
    await expect(demo.getByText("Claude is reading this PR")).toBeVisible();
    await expect(demo.locator("[data-slot=point-chip]").first()).toBeVisible();
    await expect(demo).toHaveAttribute("data-landing", "done");
    await expect(demo.locator("[data-slot=model-hairline]")).toHaveCount(0);
    const phases: unknown = await page.evaluate(() => Reflect.get(window, "landingPhases"));
    // Under reduced motion every step is an instant change: the landing never plays.
    expect(Array.isArray(phases) && phases.includes("landing")).toBe(reducedMotion !== "reduce");
  });
}

test("the checks catch what they look for", async ({ page }) => {
  await open(page, { theme: "light", palette: "default" });
  await page.evaluate(() => {
    const planted = document.createElement("div");
    planted.innerHTML = `
      <button type="button" id="planted-1"></button>
      <span id="planted-1" style="color: #c8c8c8; background: #ffffff">faint text</span>
      <style>.planted-fill { position: relative; isolation: isolate; background: #ffffff }
        .planted-fill::before { content: ""; position: absolute; inset: 0; z-index: -1; background: #000000 }</style>
      <span class="planted-fill" style="color: #c8c8c8">light on its fill</span>
      <span class="planted-fill" style="color: #333333">dark on its fill</span>
      <span aria-labelledby="planted-missing">dangling</span>
      <div aria-hidden="true"><button type="button">hidden but focusable</button></div>
      <span style="display: inline-flex; gap: 2px">
        <button type="button" style="width: 12px; height: 12px; padding: 0">a</button>
        <button type="button" style="width: 12px; height: 12px; padding: 0">b</button>
      </span>
      <div role="row" style="line-height: 20px">
        <button type="button" data-inline-target style="display: block; height: 20px; padding: 0">7</button>
        <button type="button" data-inline-target style="display: block; height: 20px; padding: 0">8</button>
      </div>
      <div role="row" style="line-height: 10px">
        <button type="button" data-inline-target style="display: block; height: 20px; padding: 0">9</button>
        <button type="button" data-inline-target style="display: block; height: 20px; padding: 0">10</button>
      </div>`;
    document.querySelector("main")?.prepend(planted);
  });
  const found = [...(await unnamedControls(page)), ...(await pageProblems(page))].join("\n");
  expect(found).toContain("button without a name");
  expect(found).toContain('id "planted-1" is used 2 times');
  expect(found).toMatch(/contrast 1\.\d+:1 < 4\.5:1 for <span> "faint text"/);
  // A ::before that fills its element is what the text is read against.
  expect(found).not.toContain("light on its fill");
  expect(found).toMatch(/contrast 1\.\d+:1 < 4\.5:1 for <span> "dark on its fill"/);
  expect(found).toContain('aria-labelledby="planted-missing"');
  expect(found).toContain('focusable inside aria-hidden: <button> "hidden but focusable"');
  expect(found).toMatch(/target 12×12 px with others within 24 px: <button> "a"/);
  // A target as tall as its line of code is inline; one taller than its line isn't.
  expect(found).not.toMatch(/<button> "[78]"/);
  expect(found).toMatch(/with others within 24 px: <button> "9"/);
});
