// What a text measures in an element's font, for names cut in the middle to fit their row.

let measuring: CanvasRenderingContext2D | null | undefined;

/** The width `text` takes in `element`'s font, or null where there's no canvas. */
export const widthOf = (element: Element, text: string): number | null => {
  measuring ??= document.createElement("canvas").getContext("2d");
  if (measuring === null) return null;
  const style = getComputedStyle(element);
  measuring.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  measuring.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
  return measuring.measureText(text).width;
};

/** Measures now, once the fonts are in, and whenever the element's width changes. */
export const observeWidth = (element: HTMLElement, measure: () => void) => {
  measure();
  void document.fonts?.ready.then(measure);
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  return () => observer.disconnect();
};
