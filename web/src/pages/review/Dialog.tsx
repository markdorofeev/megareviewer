import { type ReactNode, useRef } from "react";
import { cn } from "../../lib/utils.ts";
import {
  DialogContent,
  DialogHeader,
  Dialog as DialogRoot,
  DialogTitle,
} from "../../ui/dialog.tsx";

/**
 * A modal dialog, open while it's shown: focus moves in when it opens, stays inside, and goes back
 * when it closes; Escape and the close button call `onClose`. An element with `data-autofocus`
 * takes the focus first.
 */
export const Dialog = ({
  title,
  onClose,
  children,
  className,
  returnFocus = () => true,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  /** Whether closing gives the focus back to where it was; false when the close moved it. */
  readonly returnFocus?: () => boolean;
}) => {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        ref={popup}
        // dvh: on a phone, vh is the height without the browser's bars, taller than what shows.
        className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg", className)}
        initialFocus={() => popup.current?.querySelector<HTMLElement>("[data-autofocus]") ?? true}
        finalFocus={() => returnFocus()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </DialogRoot>
  );
};
