/**
 * @vitest-environment happy-dom
 *
 * Regression: deleting a key over the v1 REST bridge returns a generic
 * problem detail ("Bad request") in `error`, while the real reason only
 * travels in `errorCode`. The confirm dialog must translate `errorCode`
 * through the errors namespace instead of toasting the generic detail.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refreshMock = vi.fn();
const removeKeyMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock("@/lib/api-client/v1/actions/keys", () => ({
  removeKey: removeKeyMock,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, type }: any) => (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  DialogClose: ({ children }: any) => <>{children}</>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
}));

describe("DeleteKeyConfirm error toast", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderAndConfirm() {
    const { DeleteKeyConfirm } = await import(
      "@/app/[locale]/dashboard/_components/user/forms/delete-key-confirm"
    );
    await act(async () => {
      root.render(<DeleteKeyConfirm keyData={{ id: 5, name: "k", maskedKey: "sk-***" }} />);
    });
    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "confirm"
    );
    expect(confirmButton).toBeDefined();
    await act(async () => {
      confirmButton?.click();
    });
  }

  test("translates errorCode instead of showing the generic problem detail", async () => {
    removeKeyMock.mockResolvedValueOnce({
      ok: false,
      error: "Bad request",
      errorCode: "CANNOT_DELETE_LAST_KEY",
    });

    await renderAndConfirm();

    expect(toastErrorMock).toHaveBeenCalledWith("CANNOT_DELETE_LAST_KEY");
    expect(toastErrorMock).not.toHaveBeenCalledWith("Bad request");
  });

  test("falls back to the raw error when no errorCode is present", async () => {
    removeKeyMock.mockResolvedValueOnce({
      ok: false,
      error: "network down",
    });

    await renderAndConfirm();

    expect(toastErrorMock).toHaveBeenCalledWith("network down");
  });
});
