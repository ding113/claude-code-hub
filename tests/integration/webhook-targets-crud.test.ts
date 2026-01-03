/**
 * Webhook Targets Repository 集成测试
 *
 * 覆盖范围：
 * - create / get / list / update / delete
 * - updateTestResult 写回
 */

import { describe, expect, test } from "vitest";
import {
  createWebhookTarget,
  deleteWebhookTarget,
  getAllWebhookTargets,
  getWebhookTargetById,
  updateTestResult,
  updateWebhookTarget,
} from "@/repository/webhook-targets";

const run = process.env.DSN ? describe : describe.skip;

run("Webhook Targets Repository（集成测试）", () => {
  test("should create, update and delete webhook target", async () => {
    const created = await createWebhookTarget({
      name: `测试目标_${Date.now()}`,
      providerType: "wechat",
      webhookUrl: "https://example.com/webhook",
      isEnabled: true,
    });

    try {
      expect(created.id).toBeTypeOf("number");
      expect(created.name).toContain("测试目标_");
      expect(created.providerType).toBe("wechat");

      const found = await getWebhookTargetById(created.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);

      const updated = await updateWebhookTarget(created.id, {
        name: `${created.name}_updated`,
        isEnabled: false,
      });
      expect(updated.name).toContain("_updated");
      expect(updated.isEnabled).toBe(false);

      await updateTestResult(created.id, { success: true, latencyMs: 12 });
      const afterTest = await getWebhookTargetById(created.id);
      expect(afterTest?.lastTestResult?.success).toBe(true);
      expect(afterTest?.lastTestResult?.latencyMs).toBe(12);

      const list = await getAllWebhookTargets();
      expect(list.some((t) => t.id === created.id)).toBe(true);
    } finally {
      await deleteWebhookTarget(created.id);
    }
  });
});
