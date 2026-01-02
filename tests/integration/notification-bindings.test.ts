/**
 * Notification Bindings Repository 集成测试
 *
 * 覆盖范围：
 * - upsertBindings：新增/更新/删除缺失绑定
 * - getBindingsByType：带 target join
 * - deleteWebhookTarget 后绑定应被级联删除
 */

import { and, eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { db } from "@/drizzle/db";
import { notificationTargetBindings } from "@/drizzle/schema";
import { deleteWebhookTarget, createWebhookTarget } from "@/repository/webhook-targets";
import { getBindingsByType, upsertBindings } from "@/repository/notification-bindings";

const run = process.env.DSN ? describe : describe.skip;

run("Notification Bindings Repository（集成测试）", () => {
  test("should upsert bindings and cascade delete on target removal", async () => {
    const targetA = await createWebhookTarget({
      name: `绑定目标A_${Date.now()}`,
      providerType: "custom",
      webhookUrl: "https://example.com/webhook",
      customTemplate: { text: "title={{title}}" },
      isEnabled: true,
    });

    const targetB = await createWebhookTarget({
      name: `绑定目标B_${Date.now()}`,
      providerType: "wechat",
      webhookUrl: "https://example.com/webhook2",
      isEnabled: true,
    });

    try {
      // 1) 插入两条绑定
      await upsertBindings("daily_leaderboard", [
        {
          targetId: targetA.id,
          isEnabled: true,
          scheduleCron: null,
          scheduleTimezone: "Asia/Shanghai",
        },
        { targetId: targetB.id, isEnabled: false },
      ]);

      let bindings = await getBindingsByType("daily_leaderboard");
      expect(bindings.length).toBeGreaterThanOrEqual(2);

      const bindingA = bindings.find((b) => b.targetId === targetA.id);
      expect(bindingA).toBeDefined();
      expect(bindingA?.isEnabled).toBe(true);
      expect(bindingA?.target.providerType).toBe("custom");

      // 2) 仅保留 A：应删除 B 的绑定
      await upsertBindings("daily_leaderboard", [{ targetId: targetA.id, isEnabled: true }]);
      bindings = await getBindingsByType("daily_leaderboard");
      expect(bindings.some((b) => b.targetId === targetB.id)).toBe(false);
      expect(bindings.some((b) => b.targetId === targetA.id)).toBe(true);

      // 3) 删除 targetA：绑定应被级联删除（表级别校验）
      await deleteWebhookTarget(targetA.id);

      const rows = await db
        .select()
        .from(notificationTargetBindings)
        .where(
          and(
            eq(notificationTargetBindings.notificationType, "daily_leaderboard"),
            eq(notificationTargetBindings.targetId, targetA.id)
          )
        );
      expect(rows.length).toBe(0);
    } finally {
      // targetA 可能已删除，忽略错误
      try {
        await deleteWebhookTarget(targetA.id);
      } catch (_e) {
        // ignore
      }
      await deleteWebhookTarget(targetB.id);
    }
  });
});
