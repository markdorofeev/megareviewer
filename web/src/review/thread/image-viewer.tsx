import { Dialog, DialogContent, DialogTitle } from "../../ui/dialog.tsx";

/**
 * An image from a comment over the whole window, as large as fits. Esc, the close button or a
 * click beside the image closes it.
 */
export const ImageViewer = ({
  src,
  alt,
  onClose,
}: {
  readonly src: string;
  readonly alt: string;
  readonly onClose: () => void;
}) => (
  <Dialog
    open
    onOpenChange={(open) => {
      if (!open) onClose();
    }}
  >
    <DialogContent
      data-slot="image-viewer"
      // Over the whole window, not a centered card: the image is what the reviewer opened.
      className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center rounded-none bg-background/95 p-4 pt-12 ring-0 sm:max-w-none"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <DialogTitle className="sr-only">{alt}</DialogTitle>
      <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
    </DialogContent>
  </Dialog>
);
