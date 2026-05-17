import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useIpGeo } from "@/hooks/use-ip-geo";
import type { IpGeoLookupResponse } from "@/types/ip-geo";

const getMyIpGeoDetailsMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => `ipDetails.${key}`,
}));

vi.mock("@/lib/api-client/v1/actions/my-usage", () => ({
  getMyIpGeoDetails: getMyIpGeoDetailsMock,
}));

type HookSnapshot = ReturnType<typeof useIpGeo>;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function HookProbe({
  ip,
  mode,
  onSnapshot,
}: {
  ip: string;
  mode?: "my-usage";
  onSnapshot: (snapshot: HookSnapshot) => void;
}) {
  const snapshot = useIpGeo(ip, mode ? { mode } : undefined);
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

async function waitForSuccess(read: () => HookSnapshot | null): Promise<IpGeoLookupResponse> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const snapshot = read();
    if (snapshot?.isSuccess) {
      return snapshot.data;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error("Timed out waiting for useIpGeo success.");
}

describe("useIpGeo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getMyIpGeoDetailsMock.mockReset();
  });

  test("uses the public IP geo route with the active locale by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "success", country: "中国" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    let latest: HookSnapshot | null = null;
    const unmount = renderHookProbe(
      <QueryClientProvider client={createQueryClient()}>
        <HookProbe ip="203.0.113.1" onSnapshot={(snapshot) => (latest = snapshot)} />
      </QueryClientProvider>
    );

    const data = await waitForSuccess(() => latest);

    expect(fetchMock).toHaveBeenCalledWith("/api/ip-geo/203.0.113.1?lang=zh-CN");
    expect(getMyIpGeoDetailsMock).not.toHaveBeenCalled();
    expect(data).toMatchObject({ status: "success", country: "中国" });
    unmount();
  });

  test("uses the self-scoped v1 endpoint for my-usage lookups", async () => {
    getMyIpGeoDetailsMock.mockResolvedValue({
      ok: true,
      data: { status: "success", country: "日本" },
    });

    let latest: HookSnapshot | null = null;
    const unmount = renderHookProbe(
      <QueryClientProvider client={createQueryClient()}>
        <HookProbe
          ip="198.51.100.2"
          mode="my-usage"
          onSnapshot={(snapshot) => (latest = snapshot)}
        />
      </QueryClientProvider>
    );

    const data = await waitForSuccess(() => latest);

    expect(getMyIpGeoDetailsMock).toHaveBeenCalledWith({ ip: "198.51.100.2", lang: "zh-CN" });
    expect(data).toMatchObject({ status: "success", country: "日本" });
    unmount();
  });

  test("returns localized error payloads from failed my-usage lookups", async () => {
    getMyIpGeoDetailsMock.mockResolvedValue({ ok: false, error: "Denied" });

    let latest: HookSnapshot | null = null;
    const unmount = renderHookProbe(
      <QueryClientProvider client={createQueryClient()}>
        <HookProbe ip="192.0.2.3" mode="my-usage" onSnapshot={(snapshot) => (latest = snapshot)} />
      </QueryClientProvider>
    );

    await expect(waitForSuccess(() => latest)).resolves.toEqual({
      status: "error",
      error: "Denied",
    });
    unmount();
  });
});
