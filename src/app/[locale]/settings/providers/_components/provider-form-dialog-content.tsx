import type { ComponentProps } from "react";
import { DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { preventCloseOnOutsideInteraction } from "@/lib/utils/dialog";

/**
 * DialogContent preset for the provider create/edit forms: a tall, scrollable
 * shell that closes ONLY on explicit action (close button / cancel / successful
 * submit / Escape) and never on an outside click or window/tab blur, so a long
 * form is not discarded by an accidental click-away.
 *
 * Pass only the per-dialog max-width via `className`; the shared layout and the
 * no-close-on-outside-interaction behavior are baked in. Using this instead of a
 * raw `<DialogContent>` makes it impossible for a new provider dialog to forget
 * the close behavior.
 */
const PROVIDER_FORM_DIALOG_SHELL =
  "max-h-[var(--cch-viewport-height-90)] flex flex-col overflow-hidden p-0 gap-0";

export function ProviderFormDialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      {...props}
      {...preventCloseOnOutsideInteraction}
      className={cn(PROVIDER_FORM_DIALOG_SHELL, className)}
    >
      {children}
    </DialogContent>
  );
}
