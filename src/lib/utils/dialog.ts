/**
 * Props for a (shadcn/Radix) DialogContent that must NOT close on an outside
 * click or on browser/window focus loss (tab/app blur). The Escape key and the
 * explicit close paths (close button, cancel, a successful submit that flips the
 * controlled `open` state) still close it as usual.
 *
 * Used by the provider create/edit dialogs: they hold long forms that should
 * not be discarded by an accidental click-away or a focus change.
 *
 * Spread onto a DialogContent: `<DialogContent {...preventCloseOnOutsideInteraction} />`.
 */
export const preventCloseOnOutsideInteraction = {
  // Covers both pointer-down-outside and focus-outside (window/tab blur).
  // Escape is intentionally left untouched so it still dismisses the dialog.
  onInteractOutside: (event: Event) => {
    event.preventDefault();
  },
};
