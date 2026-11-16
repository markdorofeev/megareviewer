import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigate } from "./router.ts";

/** A click the page handles itself; any other leaves the browser to open a new tab or window. */
export const isPlainClick = (event: MouseEvent): boolean =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

/** An in-app link: a real `<a>`, so opening it in a new tab still works. */
export const Link = ({
  to,
  onClick,
  ...props
}: { readonly to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) => {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!isPlainClick(event)) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={follow} {...props} />;
};
