import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@/lib/api-client/v1/errors";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => sonnerMocks);

function renderWithProviders(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider
          locale="en"
          messages={{
            errors: { PERMISSION_DENIED: "Permission denied", NETWORK_ERROR: "Network error" },
          }}
          timeZone="UTC"
        >
          {node}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useApiMutation", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  test("shows localized API errors and preserves caller onError", async () => {
    const onError = vi.fn();
    const error = new ApiError({
      status: 403,
      errorCode: "auth.forbidden",
      detail: "Admin access is required.",
    });

    function TestComponent() {
      const mutation = useApiMutation({
        mutationFn: async () => {
          throw error;
        },
        onError,
      });

      return <button onClick={() => mutation.mutate({ id: 1 })}>run</button>;
    }

    const { unmount } = renderWithProviders(<TestComponent />);

    await act(async () => {
      document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(sonnerMocks.toast.error).toHaveBeenCalledWith("Permission denied");
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBe(error);
    expect(onError.mock.calls[0]?.[1]).toEqual({ id: 1 });
    unmount();
  });

  test("shows localized network errors without exposing raw fetch failures", async () => {
    const onError = vi.fn();
    const error = new Error("Failed to fetch");

    function TestComponent() {
      const mutation = useApiMutation({
        mutationFn: async () => {
          throw error;
        },
        onError,
      });

      return <button onClick={() => mutation.mutate({ id: 1 })}>run</button>;
    }

    const { unmount } = renderWithProviders(<TestComponent />);

    await act(async () => {
      document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(sonnerMocks.toast.error).toHaveBeenCalledWith("Network error");
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBe(error);
    unmount();
  });
});
