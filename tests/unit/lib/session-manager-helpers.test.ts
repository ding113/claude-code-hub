import { describe, expect, test, vi } from "vitest";

const loggerWarnMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: loggerWarnMock,
    trace: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const sanitizeHeadersMock = vi.fn();

vi.mock("@/app/v1/_lib/proxy/errors", () => ({
  sanitizeHeaders: sanitizeHeadersMock,
}));

async function loadHelpers() {
  const mod = await import("@/lib/session-manager");
  return {
    headersToSanitizedObject: mod.headersToSanitizedObject,
    parseHeaderRecord: mod.parseHeaderRecord,
  };
}

describe("SessionManager 辅助函数", () => {
  test("parseHeaderRecord：有效 JSON 对象应解析为记录", async () => {
    vi.clearAllMocks();
    const { parseHeaderRecord } = await loadHelpers();

    expect(parseHeaderRecord('{"a":"1","b":"2"}')).toEqual({ a: "1", b: "2" });
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  test("parseHeaderRecord：空对象应返回空记录", async () => {
    vi.clearAllMocks();
    const { parseHeaderRecord } = await loadHelpers();

    expect(parseHeaderRecord("{}")).toEqual({});
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  test("parseHeaderRecord：只保留字符串值", async () => {
    vi.clearAllMocks();
    const { parseHeaderRecord } = await loadHelpers();

    expect(parseHeaderRecord('{"a":"1","b":2,"c":true,"d":null,"e":{},"f":[]}')).toEqual({
      a: "1",
    });
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  test("parseHeaderRecord：无效 JSON 应返回 null 并记录 warn", async () => {
    vi.clearAllMocks();
    const { parseHeaderRecord } = await loadHelpers();

    expect(parseHeaderRecord("{bad json")).toBe(null);
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);

    const [message, meta] = loggerWarnMock.mock.calls[0] ?? [];
    expect(message).toBe("SessionManager: Failed to parse header record JSON");
    expect(meta).toEqual(expect.objectContaining({ error: expect.anything() }));
  });

  test("parseHeaderRecord：JSON 数组/null/原始值应返回 null", async () => {
    vi.clearAllMocks();
    const { parseHeaderRecord } = await loadHelpers();

    expect(parseHeaderRecord('["a"]')).toBe(null);
    expect(parseHeaderRecord("null")).toBe(null);
    expect(parseHeaderRecord("1")).toBe(null);
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  test("headersToSanitizedObject：单个 header 应正确转换", async () => {
    vi.clearAllMocks();
    const { headersToSanitizedObject } = await loadHelpers();

    const headers = new Headers({ "x-test": "1" });
    sanitizeHeadersMock.mockReturnValueOnce("x-test: 1");

    expect(headersToSanitizedObject(headers)).toEqual({ "x-test": "1" });
    expect(sanitizeHeadersMock).toHaveBeenCalledWith(headers);
  });

  test("headersToSanitizedObject：多个 header 应正确转换", async () => {
    vi.clearAllMocks();
    const { headersToSanitizedObject } = await loadHelpers();

    const headers = new Headers({ a: "1", b: "2" });
    sanitizeHeadersMock.mockReturnValueOnce("a: 1\nb: 2");

    expect(headersToSanitizedObject(headers)).toEqual({ a: "1", b: "2" });
    expect(sanitizeHeadersMock).toHaveBeenCalledWith(headers);
  });

  test("headersToSanitizedObject：空 Headers 应返回空对象", async () => {
    vi.clearAllMocks();
    const { headersToSanitizedObject } = await loadHelpers();

    const headers = new Headers();
    sanitizeHeadersMock.mockReturnValueOnce("(empty)");

    expect(headersToSanitizedObject(headers)).toEqual({});
    expect(sanitizeHeadersMock).toHaveBeenCalledWith(headers);
  });

  test("headersToSanitizedObject：值包含冒号时应保留完整值", async () => {
    vi.clearAllMocks();
    const { headersToSanitizedObject } = await loadHelpers();

    const headers = new Headers({ "x-test": "a:b:c" });
    sanitizeHeadersMock.mockReturnValueOnce("x-test: a:b:c");

    expect(headersToSanitizedObject(headers)).toEqual({ "x-test": "a:b:c" });
    expect(sanitizeHeadersMock).toHaveBeenCalledWith(headers);
  });
});
