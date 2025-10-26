"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Copy, Download, Check, Monitor, Hash } from "lucide-react";
import { getSessionDetails } from "@/actions/active-sessions";
import { useState, useEffect } from "react";
import { Section } from "@/components/section";
import { Badge } from "@/components/ui/badge";

/**
 * Session Messages 详情页面
 * 双栏布局：左侧完整内容 + 右侧信息卡片
 */
export default function SessionMessagesPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [messages, setMessages] = useState<unknown | null>(null);
  const [response, setResponse] = useState<string | null>(null);
  const [sessionStats, setSessionStats] =
    useState<
      Extract<Awaited<ReturnType<typeof getSessionDetails>>, { ok: true }>["data"]["sessionStats"]
    >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedMessages, setCopiedMessages] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);

  useEffect(() => {
    const fetchDetails = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await getSessionDetails(sessionId);
        if (result.ok) {
          setMessages(result.data.messages);
          setResponse(result.data.response);
          setSessionStats(result.data.sessionStats);
        } else {
          setError(result.error || "获取失败");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "未知错误");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchDetails();
  }, [sessionId]);

  const handleCopyMessages = async () => {
    if (!messages) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(messages, null, 2));
      setCopiedMessages(true);
      setTimeout(() => setCopiedMessages(false), 2000);
    } catch (err) {
      console.error("复制失败:", err);
    }
  };

  const handleCopyResponse = async () => {
    if (!response) return;

    try {
      await navigator.clipboard.writeText(response);
      setCopiedResponse(true);
      setTimeout(() => setCopiedResponse(false), 2000);
    } catch (err) {
      console.error("复制失败:", err);
    }
  };

  const handleDownload = () => {
    if (!messages) return;

    const jsonStr = JSON.stringify(messages, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${sessionId.substring(0, 8)}-messages.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 格式化响应体（尝试美化 JSON）
  const formatResponse = (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw;
    }
  };

  // 计算总 Token（从聚合统计）
  const totalTokens =
    (sessionStats?.totalInputTokens || 0) +
    (sessionStats?.totalOutputTokens || 0) +
    (sessionStats?.totalCacheCreationTokens || 0) +
    (sessionStats?.totalCacheReadTokens || 0);

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Session Messages</h1>
            <p className="text-sm text-muted-foreground font-mono mt-1">{sessionId}</p>
          </div>
        </div>

        {/* 操作按钮 */}
        {messages !== null && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyMessages}
              disabled={copiedMessages}
            >
              {copiedMessages ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  已复制
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  复制 Messages
                </>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              下载 Messages
            </Button>
          </div>
        )}
      </div>

      {/* 内容区域 */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">加载中...</div>
      ) : error ? (
        <div className="text-center py-16">
          <div className="text-destructive text-lg mb-2">{error}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：完整内容（占 2 列）*/}
          <div className="lg:col-span-2 space-y-6">
            {/* User-Agent 信息 */}
            {sessionStats?.userAgent && (
              <Section title="客户端信息" description="User-Agent 请求头">
                <>
                  <div className="rounded-md border bg-muted/50 p-4">
                    <div className="flex items-start gap-3">
                      <Monitor className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                      <code className="text-sm font-mono break-all">{sessionStats.userAgent}</code>
                    </div>
                  </div>
                </>
              </Section>
            )}

            {/* Messages 数据 */}
            {messages !== null && (
              <Section title="请求 Messages" description="客户端发送的消息内容">
                <>
                  <div className="rounded-md border bg-muted/50 p-6">
                    <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-words font-mono">
                      {JSON.stringify(messages, null, 2)}
                    </pre>
                  </div>
                </>
              </Section>
            )}

            {/* Response Body */}
            {response !== null && (
              <Section
                title="响应体内容"
                description="服务器返回的完整响应（5分钟 TTL）"
                actions={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyResponse}
                    disabled={copiedResponse}
                  >
                    {copiedResponse ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        复制响应体
                      </>
                    )}
                  </Button>
                }
              >
                <>
                  <div className="rounded-md border bg-muted/50 p-6 max-h-[600px] overflow-auto">
                    <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                      {formatResponse(response)}
                    </pre>
                  </div>
                </>
              </Section>
            )}

            {/* 无数据提示 */}
            {!sessionStats?.userAgent && !messages && !response && (
              <div className="text-center py-16">
                <div className="text-muted-foreground text-lg mb-2">暂无详细数据</div>
                <p className="text-sm text-muted-foreground">
                  提示：请设置环境变量 STORE_SESSION_MESSAGES=true 以启用 messages 和 response 存储
                </p>
              </div>
            )}
          </div>

          {/* 右侧：信息卡片（占 1 列）*/}
          {sessionStats && (
            <div className="space-y-4">
              {/* Session 概览卡片 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Session 概览</CardTitle>
                  <CardDescription>聚合统计信息</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* 请求数量 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">总请求数</span>
                    <Badge variant="secondary" className="font-mono font-semibold">
                      <Hash className="h-3 w-3 mr-1" />
                      {sessionStats.requestCount}
                    </Badge>
                  </div>

                  {/* 时间跨度 */}
                  {sessionStats.firstRequestAt && sessionStats.lastRequestAt && (
                    <>
                      <div className="border-t my-3" />
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">首次请求</span>
                          <code className="text-xs font-mono">
                            {new Date(sessionStats.firstRequestAt).toLocaleString("zh-CN")}
                          </code>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">最后请求</span>
                          <code className="text-xs font-mono">
                            {new Date(sessionStats.lastRequestAt).toLocaleString("zh-CN")}
                          </code>
                        </div>
                      </div>
                    </>
                  )}

                  {/* 总耗时 */}
                  {sessionStats.totalDurationMs > 0 && (
                    <>
                      <div className="border-t my-3" />
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">总耗时</span>
                        <code className="text-sm font-mono font-semibold">
                          {sessionStats.totalDurationMs < 1000
                            ? `${sessionStats.totalDurationMs}ms`
                            : `${(sessionStats.totalDurationMs / 1000).toFixed(2)}s`}
                        </code>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* 供应商和模型卡片 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">供应商与模型</CardTitle>
                  <CardDescription>使用的提供商和模型</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* 供应商列表 */}
                  {sessionStats.providers.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="text-sm text-muted-foreground">供应商</span>
                      <div className="flex flex-wrap gap-2">
                        {sessionStats.providers.map((provider: { id: number; name: string }) => (
                          <Badge key={provider.id} variant="outline" className="text-xs">
                            {provider.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 模型列表 */}
                  {sessionStats.models.length > 0 && (
                    <>
                      <div className="border-t my-3" />
                      <div className="flex flex-col gap-2">
                        <span className="text-sm text-muted-foreground">模型</span>
                        <div className="flex flex-wrap gap-2">
                          {sessionStats.models.map((model: string, idx: number) => (
                            <Badge key={idx} variant="secondary" className="text-xs font-mono">
                              {model}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Token 使用卡片 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Token 使用（总量）</CardTitle>
                  <CardDescription>所有请求的累计统计</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {sessionStats.totalInputTokens > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">总输入</span>
                      <code className="text-sm font-mono">
                        {sessionStats.totalInputTokens.toLocaleString()}
                      </code>
                    </div>
                  )}

                  {sessionStats.totalOutputTokens > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">总输出</span>
                      <code className="text-sm font-mono">
                        {sessionStats.totalOutputTokens.toLocaleString()}
                      </code>
                    </div>
                  )}

                  {sessionStats.totalCacheCreationTokens > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">缓存创建</span>
                      <code className="text-sm font-mono">
                        {sessionStats.totalCacheCreationTokens.toLocaleString()}
                      </code>
                    </div>
                  )}

                  {sessionStats.totalCacheReadTokens > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">缓存读取</span>
                      <code className="text-sm font-mono">
                        {sessionStats.totalCacheReadTokens.toLocaleString()}
                      </code>
                    </div>
                  )}

                  {totalTokens > 0 && (
                    <>
                      <div className="border-t my-3" />
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">总计</span>
                        <code className="text-sm font-mono font-semibold">
                          {totalTokens.toLocaleString()}
                        </code>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* 成本信息卡片 */}
              {sessionStats.totalCostUsd && parseFloat(sessionStats.totalCostUsd) > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">成本信息（总计）</CardTitle>
                    <CardDescription>所有请求的累计费用</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">总费用</span>
                      <code className="text-lg font-mono font-semibold text-green-600">
                        ${parseFloat(sessionStats.totalCostUsd).toFixed(6)}
                      </code>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
