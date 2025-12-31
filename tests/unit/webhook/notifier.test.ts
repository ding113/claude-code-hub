import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookNotifier } from "@/lib/webhook/notifier";
import type { StructuredMessage } from "@/lib/webhook/types";

describe("WebhookNotifier", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const createMessage = (): StructuredMessage => ({
    header: { title: "测试", level: "info" },
    sections: [],
    timestamp: new Date(),
  });

  describe("provider detection", () => {
    it("should detect wechat provider", () => {
      const notifier = new WebhookNotifier(
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
      );
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ errcode: 0, errmsg: "ok" }),
      });

      expect(() => notifier.send(createMessage())).not.toThrow();
    });

    it("should detect feishu provider", () => {
      const notifier = new WebhookNotifier("https://open.feishu.cn/open-apis/bot/v2/hook/xxx");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ code: 0, msg: "success" }),
      });

      expect(() => notifier.send(createMessage())).not.toThrow();
    });

    it("should throw for unsupported provider", () => {
      expect(() => new WebhookNotifier("https://unknown.com/webhook")).toThrow(
        "Unsupported webhook hostname: unknown.com"
      );
    });
  });

  describe("send", () => {
    it("should send message and return success", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ errcode: 0, errmsg: "ok" }),
      });

      const notifier = new WebhookNotifier(
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
      );
      const result = await notifier.send(createMessage());

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
        })
      );
    });

    it("should return error on API failure", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ errcode: 40001, errmsg: "invalid token" }),
      });

      const notifier = new WebhookNotifier(
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
        { maxRetries: 1 }
      );
      const result = await notifier.send(createMessage());

      expect(result.success).toBe(false);
      expect(result.error).toContain("40001");
    });

    it("should retry on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network error")).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ errcode: 0, errmsg: "ok" }),
      });

      const notifier = new WebhookNotifier(
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
        { maxRetries: 2 }
      );
      const result = await notifier.send(createMessage());

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("feishu response handling", () => {
    it("should handle feishu success response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ code: 0, msg: "success", data: {} }),
      });

      const notifier = new WebhookNotifier("https://open.feishu.cn/open-apis/bot/v2/hook/xxx");
      const result = await notifier.send(createMessage());

      expect(result.success).toBe(true);
    });

    it("should handle feishu error response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ code: 19024, msg: "Key Words Not Found" }),
      });

      const notifier = new WebhookNotifier("https://open.feishu.cn/open-apis/bot/v2/hook/xxx", {
        maxRetries: 1,
      });
      const result = await notifier.send(createMessage());

      expect(result.success).toBe(false);
      expect(result.error).toContain("19024");
    });
  });
});
