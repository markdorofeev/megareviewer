// Code passed to page.evaluate runs in the browser, so it needs the DOM's types.
/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { z } from "zod";

// Accessibility checks of a rendered page, without axe (MPL-2.0, outside the licenses this repo
// takes). They cover what the design system promises, measured in the browser rather than read
// from the tokens:
//
// - every control and grid has an accessible name, from Chrome's own accessibility tree;
// - ARIA references point at elements that exist, ids are unique, nothing focusable is hidden;
// - text meets 4.5:1 (3:1 when large) against what's behind it;
// - every target covers 24 × 24 px, or has no other target within that square (WCAG 2.5.8);
// - tabbing through the page shows a 2 px outline on every stop and never gets stuck.

const NAMED_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "combobox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "slider",
  "spinbutton",
  "option",
  "grid",
  "dialog",
]);

const AxValue = z.object({ value: z.unknown().optional() }).optional();
const AxTree = z.object({
  nodes: z.array(
    z.object({
      ignored: z.boolean().optional(),
      role: AxValue,
      name: AxValue,
      backendDOMNodeId: z.number().optional(),
    }),
  ),
});
const DomNode = z.object({
  node: z.object({ nodeName: z.string(), attributes: z.array(z.string()).optional() }),
});

/** Controls Chrome's accessibility tree gives no name. */
export const unnamedControls = async (page: Page): Promise<string[]> => {
  const client = await page.context().newCDPSession(page);
  await client.send("Accessibility.enable");
  const { nodes } = AxTree.parse(await client.send("Accessibility.getFullAXTree"));
  const problems: string[] = [];
  for (const node of nodes) {
    const role = typeof node.role?.value === "string" ? node.role.value : "";
    if (node.ignored === true || !NAMED_ROLES.has(role)) continue;
    const name = typeof node.name?.value === "string" ? node.name.value.trim() : "";
    if (name !== "" || node.backendDOMNodeId === undefined) continue;
    const { node: dom } = DomNode.parse(
      await client.send("DOM.describeNode", { backendNodeId: node.backendDOMNodeId }),
    );
    problems.push(
      `${role} without a name: <${dom.nodeName.toLowerCase()} ${(dom.attributes ?? []).join(" ")}>`,
    );
  }
  await client.detach();
  return problems;
};

/** Everything checked inside the page: references, ids, hidden focus, contrast, target size. */
export const pageProblems = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const problems: string[] = [];
    const describe = (element: Element) => {
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const slot = element.getAttribute("data-slot");
      return `<${element.tagName.toLowerCase()}${slot === null ? "" : ` data-slot=${slot}`}> "${text}"`;
    };

    if (document.documentElement.lang === "") problems.push("<html> has no lang");

    const ids = new Map<string, number>();
    for (const element of document.querySelectorAll("[id]")) {
      ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
    }
    for (const [id, count] of ids)
      if (count > 1) problems.push(`id "${id}" is used ${count} times`);

    for (const attribute of [
      "aria-labelledby",
      "aria-describedby",
      "aria-controls",
      "aria-activedescendant",
    ]) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        for (const id of (element.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean)) {
          if (document.getElementById(id) === null) {
            problems.push(`${attribute}="${id}" on ${describe(element)} names no element`);
          }
        }
      }
    }

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    for (const element of document.querySelectorAll(FOCUSABLE)) {
      if (
        element.closest('[aria-hidden="true"]') !== null &&
        element.getAttribute("tabindex") !== "-1"
      ) {
        problems.push(`focusable inside aria-hidden: ${describe(element)}`);
      }
    }

    // Any CSS color to RGBA, through a canvas, which resolves every color syntax.
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("no canvas");
    const rgba = (color: string): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "rgba(0, 0, 0, 0)";
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: number[], bottom: number[]) =>
      [0, 1, 2].map((i) => (top[i] ?? 0) * (top[3] ?? 1) + (bottom[i] ?? 0) * (1 - (top[3] ?? 1)));
    const luminance = (rgb: number[]) => {
      const [r = 0, g = 0, b = 0] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    /** The opaque color behind an element, or null when an image or gradient is in the way. */
    const backdrop = (element: Element): number[] | null => {
      const layers: [number, number, number, number][] = [];
      for (let at: Element | null = element; at !== null; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.backgroundImage !== "none") return null;
        const color = rgba(style.backgroundColor);
        if (color[3] > 0) layers.push(color);
        if (color[3] >= 1) break;
      }
      let result = [255, 255, 255];
      for (const layer of layers.reverse()) result = over(layer, result);
      return result;
    };

    const inactive = (element: Element) =>
      element.closest(':disabled, [aria-disabled="true"], [data-disabled]') !== null ||
      [...(element.closest("label")?.querySelectorAll(":disabled, [data-disabled]") ?? [])].length >
        0;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const checked = new Set<Element>();
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
      const element = text.parentElement;
      if (element === null || checked.has(element) || (text.textContent ?? "").trim() === "")
        continue;
      checked.add(element);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      // Hidden, or visually hidden for screen readers only.
      if (rect.width <= 1 || rect.height <= 1 || style.visibility === "hidden") continue;
      if (element.closest("[aria-hidden=true], .sr-only, script, style") !== null) continue;
      if (inactive(element)) continue;
      let opacity = 1;
      for (let at: Element | null = element; at !== null; at = at.parentElement) {
        opacity *= Number(getComputedStyle(at).opacity);
      }
      if (opacity === 0) continue;
      const behind = backdrop(element);
      if (behind === null) continue;
      const [r, g, b, a] = rgba(style.color);
      const shown = over([r, g, b, a * opacity], behind);
      const [light, dark] = [luminance(shown), luminance(behind)].sort((x, y) => y - x);
      const ratio = ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
      const size = Number.parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const needed = large ? 3 : 4.5;
      if (ratio < needed) {
        problems.push(`contrast ${ratio.toFixed(2)}:1 < ${needed}:1 for ${describe(element)}`);
      }
    }

    // A target covers 24 × 24 when every corner of that square around its center hits it, its
    // label, or its own hit area (a ::after the size of the square).
    const TARGETS =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role=button], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=option]';
    const targets = [...document.querySelectorAll(TARGETS)].filter((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || element.closest("[aria-hidden=true]"))
        return false;
      // An inline link in a sentence is exempt.
      return !(element.tagName === "A" && getComputedStyle(element).display === "inline");
    });
    for (const [index, element] of targets.entries()) {
      const box = element.getBoundingClientRect();
      if (box.width >= 24 && box.height >= 24) continue;
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      const [cx, cy] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
      const hits = [
        [cx - 11.5, cy - 11.5],
        [cx + 11.5, cy - 11.5],
        [cx - 11.5, cy + 11.5],
        [cx + 11.5, cy + 11.5],
      ].every(([x = 0, y = 0]) => {
        const hit = document.elementFromPoint(x, y);
        if (hit === null) return false;
        const label = hit.closest("label");
        return element.contains(hit) || hit.contains(element) || label?.contains(element);
      });
      if (hits) continue;
      // The spacing exception: no other target within the square.
      const square = { left: cx - 12, right: cx + 12, top: cy - 12, bottom: cy + 12 };
      const crowded = targets.some((other, at) => {
        if (at === index || other.contains(element) || element.contains(other)) return false;
        const o = other.getBoundingClientRect();
        return (
          o.left < square.right &&
          o.right > square.left &&
          o.top < square.bottom &&
          o.bottom > square.top
        );
      });
      if (crowded) {
        problems.push(
          `target ${Math.round(box.width)}×${Math.round(box.height)} px with others within 24 px: ${describe(element)}`,
        );
      }
    }
    window.scrollTo(0, 0);
    return problems;
  });

/**
 * Tabs through the whole page: every stop must show a 2 px outline, and focus must keep moving
 * until it leaves the page. Returns the problems and how many stops there were.
 */
export const focusProblems = async (
  page: Page,
  limit = 600,
): Promise<{ readonly problems: string[]; readonly stops: number }> => {
  const problems: string[] = [];
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  let previous = "";
  let stops = 0;
  for (; stops < limit; stops++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null || element === document.body) return null;
      const style = getComputedStyle(element);
      const text = (element.textContent ?? element.getAttribute("aria-label") ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40);
      return {
        key: `${element.tagName}#${element.id}|${text}|${element.getBoundingClientRect().top + window.scrollY}`,
        label: `<${element.tagName.toLowerCase()}> "${text}"`,
        outline: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2,
      };
    });
    if (stop === null) break;
    if (stop.key === previous) {
      problems.push(`focus stuck on ${stop.label}`);
      break;
    }
    previous = stop.key;
    if (!stop.outline) problems.push(`no visible focus on ${stop.label}`);
  }
  if (stops === limit) problems.push(`focus never left the page after ${limit} tabs`);
  return { problems, stops };
};
