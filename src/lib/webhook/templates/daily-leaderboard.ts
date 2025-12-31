import type { DailyLeaderboardData, StructuredMessage } from "../types";

function getMedal(index: number): string {
  const medals = ["🥇", "🥈", "🥉"];
  return medals[index] || `${index + 1}.`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(2)}K`;
  }
  return tokens.toLocaleString();
}

export function buildDailyLeaderboardMessage(data: DailyLeaderboardData): StructuredMessage {
  if (data.entries.length === 0) {
    return {
      header: {
        title: "过去24小时用户消费排行榜",
        icon: "📊",
        level: "info",
      },
      sections: [
        {
          content: [
            { type: "quote", value: `统计时间: ${data.date}` },
            { type: "text", value: "暂无数据" },
          ],
        },
      ],
      timestamp: new Date(),
    };
  }

  const listItems = data.entries.map((entry, index) => ({
    icon: getMedal(index),
    primary: `${entry.userName} (ID: ${entry.userId})`,
    secondary: `消费 $${entry.totalCost.toFixed(4)} · 请求 ${entry.totalRequests.toLocaleString()} 次 · Token ${formatTokens(entry.totalTokens)}`,
  }));

  return {
    header: {
      title: "过去24小时用户消费排行榜",
      icon: "📊",
      level: "info",
    },
    sections: [
      {
        content: [{ type: "quote", value: `统计时间: ${data.date}` }],
      },
      {
        title: "排名情况",
        content: [{ type: "list", style: "ordered", items: listItems }],
      },
      {
        content: [{ type: "divider" }],
      },
      {
        title: "总览",
        content: [
          {
            type: "text",
            value: `总请求 ${data.totalRequests.toLocaleString()} 次 · 总消费 $${data.totalCost.toFixed(4)}`,
          },
        ],
      },
    ],
    timestamp: new Date(),
  };
}
