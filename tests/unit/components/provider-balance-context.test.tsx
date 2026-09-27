import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderBalanceStore } from "@/app/[locale]/settings/providers/_components/balance/balance-store";
import {
  ProviderBalanceProvider,
  useProviderBalance,
} from "@/app/[locale]/settings/providers/_components/balance/provider-balance-context";
import type { ProviderBalanceMap, ProviderBalanceSnapshot } from "@/types/provider-balance";

function snapshot(providerId: number, balance: number): ProviderBalanceSnapshot {
  return {
    providerId,
    status: "ok",
    source: "new-api-token-usage",
    balance,
    currency: "USD",
    totalGranted: null,
    totalUsed: null,
    unlimited: false,
    expiresAt: null,
    checkedAt: "2026-09-24T00:00:00.000Z",
    errorCode: null,
  };
}

const fetchBalances = vi.fn(
  async (ids: number[]): Promise<ProviderBalanceMap> =>
    Object.fromEntries(ids.map((id) => [id, snapshot(id, 42)])) as ProviderBalanceMap
);

vi.mock("@/lib/api-client/v1/actions/provider-balance", () => ({
  getProviderBalances: (ids: number[], options: { refresh: boolean }) =>
    fetchBalances(ids, options as never),
  refreshProviderBalance: vi.fn(),
}));

// useInViewOnce 在测试环境视为立刻可见；这里替换成真实的登记触发，
// 让组件装配后立刻请求余额。
vi.mock("@/lib/hooks/use-in-view-once", () => ({
  useInViewOnce: () => ({ ref: () => {}, isInView: true }),
}));

/** 读取余额并把它渲染成可断言的文本 */
function Probe({ providerId }: { providerId: number }) {
  const { entry } = useProviderBalance<HTMLDivElement>(providerId);
  return <div data-testid="probe">{`${entry.status}:${entry.snapshot?.balance ?? "none"}`}</div>;
}

function readProbe(container: HTMLElement): string {
  return container.querySelector('[data-testid="probe"]')?.textContent ?? "";
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fetchBalances.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

async function renderStrict(children: React.ReactNode) {
  await act(async () => {
    root = createRoot(container);
    root.render(<StrictMode>{children}</StrictMode>);
  });
}

describe("ProviderBalanceProvider 在 StrictMode 下", () => {
  it("effect 重跑后余额仍能加载", async () => {
    await renderStrict(
      <ProviderBalanceProvider autoRefreshMs={0}>
        <Probe providerId={1} />
      </ProviderBalanceProvider>
    );

    // StrictMode 的 setup - cleanup - setup 之后必须仍然发出请求
    await act(async () => {
      await vi.waitFor(() => expect(fetchBalances).toHaveBeenCalled());
    });
    expect(readProbe(container)).toBe("ready:42");
  });

  it("外部注入的 store 不会被卸载释放", async () => {
    const injected = new ProviderBalanceStore({ fetchBalances, batchDelayMs: 0 });
    const disposeSpy = vi.spyOn(injected, "dispose");

    await renderStrict(
      <ProviderBalanceProvider store={injected} autoRefreshMs={0}>
        <Probe providerId={2} />
      </ProviderBalanceProvider>
    );

    await act(async () => {
      await vi.waitFor(() => expect(fetchBalances).toHaveBeenCalled());
    });
    expect(readProbe(container)).toBe("ready:42");

    act(() => {
      root.unmount();
    });
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it("卸载后定时刷新不再访问已释放的 store", async () => {
    const injected = new ProviderBalanceStore({ fetchBalances, batchDelayMs: 0 });
    const revalidateSpy = vi.spyOn(injected, "revalidateTracked");

    await renderStrict(
      <ProviderBalanceProvider store={injected} autoRefreshMs={20}>
        <Probe providerId={3} />
      </ProviderBalanceProvider>
    );

    act(() => {
      root.unmount();
    });

    const callsAfterUnmount = revalidateSpy.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(revalidateSpy.mock.calls.length).toBe(callsAfterUnmount);
  });

  it("自动更新按间隔重新读取已登记的供应商", async () => {
    const injected = new ProviderBalanceStore({ fetchBalances, batchDelayMs: 0 });

    await renderStrict(
      <ProviderBalanceProvider store={injected} autoRefreshMs={20}>
        <Probe providerId={4} />
      </ProviderBalanceProvider>
    );

    await act(async () => {
      await vi.waitFor(() => expect(fetchBalances).toHaveBeenCalled());
    });
    expect(readProbe(container)).toBe("ready:42");

    const before = fetchBalances.mock.calls.length;
    await act(async () => {
      await vi.waitFor(() => expect(fetchBalances.mock.calls.length).toBeGreaterThan(before), {
        timeout: 1000,
      });
    });
  });
});

describe("ProviderBalanceProvider 释放顺序", () => {
  it("自建 store 在卸载时被释放", async () => {
    const disposeSpy = vi.spyOn(ProviderBalanceStore.prototype, "dispose");

    await renderStrict(
      <ProviderBalanceProvider autoRefreshMs={0}>
        <Probe providerId={5} />
      </ProviderBalanceProvider>
    );

    // StrictMode 初次挂载已经跑过一次 cleanup，只统计卸载新增的那次调用
    disposeSpy.mockClear();
    act(() => {
      root.unmount();
    });

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
  });

  it("定时器在 store 就绪前不会访问它", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderStrict(
      <ProviderBalanceProvider autoRefreshMs={5}>
        <Probe providerId={6} />
      </ProviderBalanceProvider>
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
