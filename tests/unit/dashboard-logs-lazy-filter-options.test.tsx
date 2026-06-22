/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useLazyModels } from "@/app/[locale]/dashboard/logs/_hooks/use-lazy-filter-options";

const getModelListMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client/v1/actions/usage-logs", () => ({
  getEndpointList: vi.fn(async () => ({ ok: true, data: [] })),
  getModelList: getModelListMock,
  getStatusCodeList: vi.fn(async () => ({ ok: true, data: [] })),
}));

type HookSnapshot = ReturnType<typeof useLazyModels>;

function HookProbe({ onSnapshot }: { onSnapshot: (snapshot: HookSnapshot) => void }) {
  const snapshot = useLazyModels();

  useEffect(() => {
    onSnapshot(snapshot);
  }, [snapshot, onSnapshot]);

  return null;
}

function renderHookProbe(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return () => {
    act(() => root.unmount());
    container.remove();
  };
}

async function waitForLoaded(read: () => HookSnapshot | null): Promise<HookSnapshot> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 1000) {
    const snapshot = read();
    if (snapshot?.isLoaded) return snapshot;

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  throw new Error("Timed out waiting for useLazyModels to load.");
}

describe("useLazyModels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getModelListMock.mockReset();
  });

  test("drops malformed model options instead of failing the lazy load", async () => {
    getModelListMock.mockResolvedValue({
      ok: true,
      data: ["", null, 42, "   ", "claude-sonnet-4-5"] as unknown as string[],
    });

    let latest: HookSnapshot | null = null;
    const unmount = renderHookProbe(
      <HookProbe
        onSnapshot={(snapshot) => {
          latest = snapshot;
        }}
      />
    );

    await act(async () => {
      latest?.onOpenChange(true);
    });

    const loaded = await waitForLoaded(() => latest);

    expect(loaded.error).toBeNull();
    expect(loaded.data).toEqual(["claude-sonnet-4-5"]);

    unmount();
  });
});
