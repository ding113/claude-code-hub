import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "实时数据大屏 - Claude Code Hub",
  description: "Claude Code Hub 实时监控数据大屏",
};

export default function BigScreenLayout({ children }: { children: React.ReactNode }) {
  // 全屏布局，移除所有导航栏、侧边栏等元素
  return <>{children}</>;
}
