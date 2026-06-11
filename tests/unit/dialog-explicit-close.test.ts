import { describe, expect, it, vi } from "vitest";
import { explicitCloseOnlyDialogProps } from "@/lib/utils/dialog";

describe("explicitCloseOnlyDialogProps", () => {
  it("prevents the dialog from closing on outside interaction (click-away / window focus loss)", () => {
    const event = { preventDefault: vi.fn() };
    explicitCloseOnlyDialogProps.onInteractOutside(event as unknown as Event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("prevents the dialog from closing on the Escape key", () => {
    const event = { preventDefault: vi.fn() };
    explicitCloseOnlyDialogProps.onEscapeKeyDown(event as unknown as KeyboardEvent);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("exposes exactly the two implicit-close handlers and nothing that itself closes the dialog", () => {
    // The close button / cancel / successful submit still close the dialog via
    // its own onOpenChange; these props only neutralize the implicit paths.
    expect(Object.keys(explicitCloseOnlyDialogProps).sort()).toEqual([
      "onEscapeKeyDown",
      "onInteractOutside",
    ]);
  });
});
