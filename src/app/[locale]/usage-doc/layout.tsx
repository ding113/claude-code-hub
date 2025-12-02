import { Book, LogIn } from "lucide-react";
import type { Metadata } from "next";
import { Link } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { DashboardHeader } from "../dashboard/_components/dashboard-header";

export const metadata: Metadata = {
  title: "使用文档 - Claude Code Hub",
  description: "Claude Code Hub API 代理服务使用文档和指南",
};

/**
 * 文档页面布局
 * 提供文档页面的容器、样式和共用头部
 * 支持未登录访问：未登录时显示简化版头部，已登录时显示完整的 DashboardHeader
 */
export default async function UsageDocLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <div className="min-h-screen bg-background">
      {/* 条件渲染头部：已登录显示 DashboardHeader，未登录显示简化版头部 */}
      {session ? (
        <DashboardHeader session={session} />
      ) : (
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-14 items-center justify-between px-6">
            <div className="flex items-center gap-2">
              <Book className="h-5 w-5 text-orange-500" />
              <span className="font-semibold">使用文档</span>
            </div>
            <Link
              href="/login?from=/usage-doc"
              className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
            >
              <LogIn className="h-4 w-4" />
              登录控制台
            </Link>
          </div>
        </header>
      )}

      {/* 文档内容主体 */}
      <main className="mx-auto w-full max-w-7xl px-6 py-8">
        {/* 文档容器 */}
        {children}
      </main>
    </div>
  );
}
