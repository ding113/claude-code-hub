import { describe, expect, it, vi } from "vitest";
import { preventCloseOnOutsideInteraction } from "@/lib/utils/dialog";

describe("preventCloseOnOutsideInteraction", () => {
  it("prevents the dialog from closing on outside interaction (click-away / window focus loss)", () => {
    const event = { preventDefault: vi.fn() };
    preventCloseOnOutsideInteraction.onInteractOutside(event as unknown as Event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("does NOT intercept the Escape key, so Escape still dismisses the dialog", () => {
    // Escape closing is intentionally preserved; the helper must not register an
    // onEscapeKeyDown handler (which would otherwise need preventDefault to block it).
    expect(preventCloseOnOutsideInteraction).not.toHaveProperty("onEscapeKeyDown");
  });

  it("exposes only the outside-interaction guard and nothing that itself closes the dialog", () => {
    expect(Object.keys(preventCloseOnOutsideInteraction)).toEqual(["onInteractOutside"]);
  });
});
