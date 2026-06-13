/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  BATCH_TEST_CONCURRENCY,
  type UseBatchProviderTestResult,
  useBatchProviderTest,
} from "@/app/[locale]/settings/providers/_components/batch-test/use-batch-provider-test";

const { testProviderByIdMock } = vi.hoisted(() => ({
  testProviderByIdMock: vi.fn(),
}));

vi.mock("@/lib/api-client/v1/actions/providers", () => ({
  testProviderById: testProviderByIdMock,
}));

function greenData(latencyMs = 100) {
  return {
    success: true,
    status: "green" as const,
    subStatus: "success",
    message: "ok",
    latencyMs,
    httpStatusCode: 200,
    model: "claude-sonnet-4-5",
  };
}

function redData() {
  return {
    success: false,
    status: "red" as const,
    subStatus: "auth_error",
    message: "auth failed",
    latencyMs: 50,
    httpStatusCode: 401,
    errorMessage: "Invalid key",
  };
}

describe("useBatchProviderTest", () => {
  let hook: UseBatchProviderTestResult;
  let root: Root;
  let container: HTMLDivElement;

  function HookProbe() {
    hook = useBatchProviderTest();
    return null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<HookProbe />);
    });

    return () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    };
  });

  test("按结果状态记录每个供应商：green/yellow/red 与失败信息", async () => {
    testProviderByIdMock.mockImplementation(async (providerId: number) => {
      if (providerId === 1) return { ok: true, data: greenData(80) };
      if (providerId === 2) return { ok: true, data: { ...greenData(6000), status: "yellow" } };
      if (providerId === 3) return { ok: true, data: redData() };
      return { ok: false, error: "network down" };
    });

    await act(async () => {
      await hook.run([1, 2, 3, 4]);
    });

    expect(hook.isRunning).toBe(false);
    expect(hook.results[1]).toMatchObject({ status: "green", latencyMs: 80 });
    expect(hook.results[2]).toMatchObject({ status: "yellow" });
    expect(hook.results[3]).toMatchObject({ status: "red", message: "Invalid key" });
    expect(hook.results[4]).toMatchObject({ status: "error", message: "network down" });
  });

  test("并发执行不超过上限", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    testProviderByIdMock.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { ok: true, data: greenData() };
    });

    const ids = Array.from({ length: 12 }, (_, index) => index + 1);
    await act(async () => {
      await hook.run(ids);
    });

    expect(testProviderByIdMock).toHaveBeenCalledTimes(12);
    expect(maxInFlight).toBeLessThanOrEqual(BATCH_TEST_CONCURRENCY);
  });

  test("model 覆盖会去除空白后传给接口，空白则不传", async () => {
    testProviderByIdMock.mockResolvedValue({ ok: true, data: greenData() });

    await act(async () => {
      await hook.run([1], "  claude-sonnet-4-5  ");
    });
    expect(testProviderByIdMock).toHaveBeenLastCalledWith(1, { model: "claude-sonnet-4-5" });

    await act(async () => {
      await hook.run([1], "   ");
    });
    expect(testProviderByIdMock).toHaveBeenLastCalledWith(1, undefined);
  });

  test("取消后不再发起新请求，剩余标记为 canceled，已发出的保留结果", async () => {
    const resolvers: Array<() => void> = [];
    testProviderByIdMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve({ ok: true, data: greenData() }));
        })
    );

    const ids = Array.from({ length: 8 }, (_, index) => index + 1);
    let runPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      runPromise = hook.run(ids);
      // Let the first wave of workers start
      await Promise.resolve();
    });

    expect(testProviderByIdMock).toHaveBeenCalledTimes(BATCH_TEST_CONCURRENCY);

    act(() => {
      hook.cancel();
    });

    await act(async () => {
      for (const resolve of resolvers) resolve();
      await runPromise;
    });

    // No new requests were launched after cancel
    expect(testProviderByIdMock).toHaveBeenCalledTimes(BATCH_TEST_CONCURRENCY);
    const statuses = ids.map((id) => hook.results[id]?.status);
    expect(statuses.filter((status) => status === "green")).toHaveLength(BATCH_TEST_CONCURRENCY);
    expect(statuses.filter((status) => status === "canceled")).toHaveLength(
      ids.length - BATCH_TEST_CONCURRENCY
    );
    expect(hook.isRunning).toBe(false);
  });

  test("reset 清空结果并结束运行状态", async () => {
    testProviderByIdMock.mockResolvedValue({ ok: true, data: greenData() });
    await act(async () => {
      await hook.run([1]);
    });
    expect(Object.keys(hook.results)).toHaveLength(1);

    act(() => {
      hook.reset();
    });
    expect(hook.results).toEqual({});
    expect(hook.isRunning).toBe(false);
  });
});
