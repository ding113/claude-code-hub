import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SystemSettings } from "@/types/system-config";

// F1 门控模式解析链：系统设置快照（proxy-runtime）优先，env STREAM_GATE_MODE 兜底。
// 通过真实 proxy-runtime 模块驱动快照生命周期，验证 resolveStreamGateMode 的三级回退。

const getCachedSystemSettingsMock = vi.fn();
const getEnvConfigMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: () => getCachedSystemSettingsMock(),
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => getEnvConfigMock(),
}));

// 真实 logger 模块加载时读取完整 env；此处仅需静默日志
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

function createSettings(overrides: Partial<SystemSettings> = {}): Partial<SystemSettings> {
  return {
    streamGateMode: "enforce",
    affinityIgnoreClientSessionId: true,
    ...overrides,
  };
}

async function loadModules() {
  const runtime = await import("@/lib/system-settings/proxy-runtime");
  const gate = await import("@/app/v1/_lib/proxy/stream-gate/stream-content-gate");
  return { ...runtime, ...gate };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  getEnvConfigMock.mockReturnValue({ STREAM_GATE_MODE: "off" });
});

describe("getProxyRuntimeSettings / getCachedProxyRuntimeSettings", () => {
  test("无快照时 getCachedProxyRuntimeSettings 返回 null", async () => {
    const { getCachedProxyRuntimeSettings } = await loadModules();
    expect(getCachedProxyRuntimeSettings()).toBeNull();
  });

  test("getProxyRuntimeSettings 从系统设置缓存映射两字段并更新快照", async () => {
    getCachedSystemSettingsMock.mockResolvedValue(
      createSettings({ streamGateMode: "shadow", affinityIgnoreClientSessionId: false })
    );
    const { getProxyRuntimeSettings, getCachedProxyRuntimeSettings } = await loadModules();

    const settings = await getProxyRuntimeSettings();
    expect(settings).toEqual({ streamGateMode: "shadow", affinityIgnoreClientSessionId: false });
    expect(getCachedProxyRuntimeSettings()).toEqual({
      streamGateMode: "shadow",
      affinityIgnoreClientSessionId: false,
    });
  });

  test("系统设置读取异常且无快照时回退 env（affinity 默认开）", async () => {
    getCachedSystemSettingsMock.mockRejectedValue(new Error("db down"));
    getEnvConfigMock.mockReturnValue({ STREAM_GATE_MODE: "shadow" });
    const { getProxyRuntimeSettings } = await loadModules();

    const settings = await getProxyRuntimeSettings();
    expect(settings).toEqual({ streamGateMode: "shadow", affinityIgnoreClientSessionId: true });
  });

  test("系统设置读取异常但已有快照时返回旧快照", async () => {
    getCachedSystemSettingsMock.mockResolvedValueOnce(createSettings({ streamGateMode: "off" }));
    const { getProxyRuntimeSettings } = await loadModules();
    await getProxyRuntimeSettings();

    getCachedSystemSettingsMock.mockRejectedValueOnce(new Error("db down"));
    const settings = await getProxyRuntimeSettings();
    expect(settings).toEqual({ streamGateMode: "off", affinityIgnoreClientSessionId: true });
  });
});

describe("resolveStreamGateMode", () => {
  test("快照优先于 env", async () => {
    getCachedSystemSettingsMock.mockResolvedValue(createSettings({ streamGateMode: "shadow" }));
    getEnvConfigMock.mockReturnValue({ STREAM_GATE_MODE: "enforce" });
    const { getProxyRuntimeSettings, resolveStreamGateMode } = await loadModules();

    await getProxyRuntimeSettings();
    expect(resolveStreamGateMode()).toBe("shadow");
  });

  test("无快照时回退 env STREAM_GATE_MODE", async () => {
    getEnvConfigMock.mockReturnValue({ STREAM_GATE_MODE: "enforce" });
    const { resolveStreamGateMode } = await loadModules();

    expect(resolveStreamGateMode()).toBe("enforce");
  });

  test("无快照且 env 不可用时 fail-safe 返回 off", async () => {
    getEnvConfigMock.mockImplementation(() => {
      throw new Error("env not ready");
    });
    const { resolveStreamGateMode } = await loadModules();

    expect(resolveStreamGateMode()).toBe("off");
  });
});
