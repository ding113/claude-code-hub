/**
 * Props for a (shadcn/Radix) DialogContent that must close ONLY through an
 * explicit user action — the close button, a cancel button, or a successful
 * submit that flips the controlled `open` state. The dialog will NOT close on
 * an outside click, on browser/window focus loss, or on the Escape key.
 *
 * Used by the provider create/edit dialogs: they hold long forms that should
 * not be discarded by an accidental click-away or a focus change.
 *
 * Spread onto a DialogContent: `<DialogContent {...explicitCloseOnlyDialogProps} />`.
 */
export const explicitCloseOnlyDialogProps = {
  // Covers both pointer-down-outside and focus-outside (window/tab blur).
  onInteractOutside: (event: Event) => {
    event.preventDefault();
  },
  onEscapeKeyDown: (event: KeyboardEvent) => {
    event.preventDefault();
  },
};
