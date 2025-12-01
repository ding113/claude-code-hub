"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { formatCostForStorage } from "@/lib/utils/currency";
import {
  getActiveKeysForUserFromDB,
  getActiveUsersFromDB,
  getKeyStatisticsFromDB,
  getMixedStatisticsFromDB,
  getUserStatisticsFromDB,
} from "@/repository/statistics";
import { getSystemSettings } from "@/repository/system-config";
import type {
  ChartDataItem,
  DatabaseKey,
  DatabaseKeyStatRow,
  DatabaseStatRow,
  DatabaseUser,
  StatisticsUser,
  TimeRange,
  UserStatisticsData,
} from "@/types/statistics";
import { DEFAULT_TIME_RANGE, TIME_RANGE_OPTIONS } from "@/types/statistics";
import type { ActionResult } from "./types";

/**
 * 生成图表数据使用的用户键，避免名称碰撞
 */
const createDataKey = (prefix: string, id: number): string => `${prefix}-${id}`;

/**
 * 获取用户统计数据，用于图表展示
 */
export async function getUserStatistics(
  timeRange: TimeRange = DEFAULT_TIME_RANGE
): Promise<ActionResult<UserStatisticsData>> {
  try {
    const session = await getSession();
    if (!session) {
      return {
        ok: false,
        error: "未登录",
      };
    }

    // 获取时间范围配置
    const rangeConfig = TIME_RANGE_OPTIONS.find((option) => option.key === timeRange);
    if (!rangeConfig) {
      throw new Error(`Invalid time range: ${timeRange}`);
    }

    const settings = await getSystemSettings();
    const isAdmin = session.user.role === "admin";

    // 确定显示模式
    const mode: "users" | "keys" | "mixed" = isAdmin
      ? "users"
      : settings.allowGlobalUsageView
        ? "mixed"
        : "keys";

    const prefix = mode === "mixed" ? "key" : mode === "users" ? "user" : "key";

    let statsData: Array<DatabaseStatRow | DatabaseKeyStatRow>;
    let entities: Array<DatabaseUser | DatabaseKey>;

    if (mode === "users") {
      // Admin: 显示所有用户
      const [userStats, userList] = await Promise.all([
        getUserStatisticsFromDB(timeRange),
        getActiveUsersFromDB(),
      ]);
      statsData = userStats;
      entities = userList;
    } else if (mode === "mixed") {
      // 非 Admin + allowGlobalUsageView: 自己的密钥明细 + 其他用户汇总
      const [ownKeysList, mixedData] = await Promise.all([
        getActiveKeysForUserFromDB(session.user.id),
        getMixedStatisticsFromDB(session.user.id, timeRange),
      ]);

      // 合并数据：自己的密钥 + 其他用户的虚拟条目
      statsData = [...mixedData.ownKeys, ...mixedData.othersAggregate];

      // 合并实体列表：自己的密钥 + 其他用户虚拟实体
      entities = [...ownKeysList, { id: -1, name: "其他用户" }];
    } else {
      // 非 Admin + !allowGlobalUsageView: 仅显示自己的密钥
      const [keyStats, keyList] = await Promise.all([
        getKeyStatisticsFromDB(session.user.id, timeRange),
        getActiveKeysForUserFromDB(session.user.id),
      ]);
      statsData = keyStats;
      entities = keyList;
    }

    // 将数据转换为适合图表的格式
    const dataByDate = new Map<string, ChartDataItem>();

    statsData.forEach((row) => {
      // 根据分辨率格式化日期
      let dateStr: string;
      if (rangeConfig.resolution === "hour") {
        // 小时分辨率：显示为 "HH:mm" 格式
        const hour = new Date(row.date);
        dateStr = hour.toISOString();
      } else {
        // 天分辨率：显示为 "YYYY-MM-DD" 格式
        dateStr = new Date(row.date).toISOString().split("T")[0];
      }

      if (!dataByDate.has(dateStr)) {
        dataByDate.set(dateStr, {
          date: dateStr,
        });
      }

      const dateData = dataByDate.get(dateStr)!;

      const entityId = "user_id" in row ? row.user_id : row.key_id;
      const entityKey = createDataKey(prefix, entityId);

      // 安全地处理大数值，防止精度问题
      const cost = formatCostForStorage(row.total_cost) ?? formatCostForStorage(0)!;
      const calls = row.api_calls || 0;

      // 为每个用户创建消费和调用次数的键
      dateData[`${entityKey}_cost`] = cost;
      dateData[`${entityKey}_calls`] = calls;
    });

    const result: UserStatisticsData = {
      chartData: Array.from(dataByDate.values()),
      users: entities.map(
        (entity): StatisticsUser => ({
          id: entity.id,
          name: entity.name || (mode === "users" ? `User${entity.id}` : `Key${entity.id}`),
          dataKey: createDataKey(prefix, entity.id),
        })
      ),
      timeRange,
      resolution: rangeConfig.resolution,
      mode,
    };

    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    logger.error("Failed to get user statistics:", error);

    // 提供更具体的错误信息
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    if (errorMessage.includes("numeric field overflow")) {
      return {
        ok: false,
        error: "数据金额过大，请检查数据库中的费用记录",
      };
    }

    return {
      ok: false,
      error: `获取统计数据失败：${errorMessage}`,
    };
  }
}
