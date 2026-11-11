// Applies the stored theme and diff palette before first paint, so a reload never flashes the
// other theme. A classic script, not a module, because modules run after the page is parsed, and
// a file, not inline, because the server's CSP allows scripts from 'self' only. web/src/lib/theme.ts
// reads and writes the same keys.
(() => {
  const read = (key) => {
    try {
      const text = window.localStorage.getItem(`megareviewer:${key}`);
      return text === null ? undefined : JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  const theme = read("theme");
  const dark =
    theme === "dark" ||
    (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  if (read("diffPalette") === "cb") root.dataset.diffPalette = "cb";
})();
