"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, Download, Hash, Monitor, XCircle } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getSessionDetails, terminateActiveSession } from "@/actions/active-sessions";
import { Section } from "@/components/section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePathname, useRouter } from "@/i18n/routing";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import { RequestListSidebar } from "./_components/request-list-sidebar";

async function fetchSystemSettings(): Promise<{
  currencyDisplay: CurrencyCode;
}> {
  const response = await fetch("/api/system-settings");
  if (!response.ok) {
    throw new Error("Failed to fetch system settings");
  }
  return response.json();
}

/**
 * Session Messages 详情页面
 * 三栏布局：左侧请求列表 + 中间完整内容 + 右侧信息卡片
 */
export default function SessionMessagesPage() {
  const t = useTranslations("dashboard.sessions");
  const tDesc = useTranslations("dashboard.description");
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const sessionId = params.sessionId as string;

  // 从 URL 获取当前选中的请求序号
  const seqParam = searchParams.get("seq");
  const selectedSeq = seqParam ? parseInt(seqParam, 10) : null;

  const [messages, setMessages] = useState<unknown | null>(null);
  const [response, setResponse] = useState<string | null>(null);
  const [sessionStats, setSessionStats] =
    useState<
      Extract<Awaited<ReturnType<typeof getSessionDetails>>, { ok: true }>["data"]["sessionStats"]
    >(null);
  const [currentSequence, setCurrentSequence] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedMessages, setCopiedMessages] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);
  const [showTerminateDialog, setShowTerminateDialog] = useState(false);
  const [isTerminating, setIsTerminating] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { data: systemSettings } = useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
  });

  const currencyCode = systemSettings?.currencyDisplay || "USD";

  // 处理请求选择（更新 URL）
  const handleSelectRequest = useCallback(
    (seq: number) => {
      const params = new URLSearchParams(window.location.search);
      params.set("seq", seq.toString());
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname]
  );

  useEffect(() => {
    const fetchDetails = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // 传入 requestSequence 参数以获取特定请求的消息
        const result = await getSessionDetails(sessionId, selectedSeq ?? undefined);
        if (result.ok) {
          setMessages(result.data.messages);
          setResponse(result.data.response);
          setSessionStats(result.data.sessionStats);
          setCurrentSequence(result.data.currentSequence);
        } else {
          setError(result.error || t("status.fetchFailed"));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("status.unknownError"));
      } finally {
        setIsLoading(false);
      }
    };

    void fetchDetails();
  }, [sessionId, selectedSeq, t]);

  const handleCopyMessages = async () => {
    if (!messages) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(messages, null, 2));
      setCopiedMessages(true);
      setTimeout(() => setCopiedMessages(false), 2000);
    } catch (err) {
      console.error(t("errors.copyFailed"), err);
    }
  };

  const handleCopyResponse = async () => {
    if (!response) return;

    try {
      await navigator.clipboard.writeText(response);
      setCopiedResponse(true);
      setTimeout(() => setCopiedResponse(false), 2000);
    } catch (err) {
      console.error(t("errors.copyFailed"), err);
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

  const handleTerminateSession = async () => {
    setIsTerminating(true);
    try {
      const result = await terminateActiveSession(sessionId);
      if (result.ok) {
        toast.success(t("actions.terminateSuccess"));
        // 终止成功后返回列表页
        router.push("/dashboard/sessions");
      } else {
        toast.error(result.error || t("actions.terminateFailed"));
      }
    } catch (_error) {
      toast.error(t("actions.terminateFailed"));
    } finally {
      setIsTerminating(false);
      setShowTerminateDialog(false);
    }
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
    <div className="flex h-full">
      {/* 左侧：请求列表侧边栏 */}
      <RequestListSidebar
        sessionId={sessionId}
        selectedSeq={selectedSeq ?? currentSequence}
        onSelect={handleSelectRequest}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />

      {/* 主内容区域 */}
      <div className="flex-1 overflow-auto">
        <div className="space-y-6 p-6">
          {/* 标题栏 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="outline" size="sm" onClick={() => router.back()}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t("actions.back")}
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold">{t("details.title")}</h1>
                  {(selectedSeq ?? currentSequence) && (
                    <Badge variant="outline" className="text-sm">
                      #{selectedSeq ?? currentSequence}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground font-mono mt-1">{sessionId}</p>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2">
              {messages !== null && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyMessages}
                    disabled={copiedMessages}
                  >
                    {copiedMessages ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        {t("actions.copied")}
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        {t("actions.copyMessages")}
                      </>
                    )}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDownload}>
                    <Download className="h-4 w-4 mr-2" />
                    {t("actions.downloadMessages")}
                  </Button>
                </>
              )}
              {/* 终止 Session 按钮 */}
              {sessionStats && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowTerminateDialog(true)}
                  disabled={isTerminating}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  {t("actions.terminate")}
                </Button>
              )}
            </div>
          </div>

          {/* 内容区域 */}
          {isLoading ? (
            <div className="text-center py-16 text-muted-foreground">{t("status.loading")}</div>
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
                  <Section title={t("details.clientInfo")} description={tDesc("clientInfo")}>
                    <div className="rounded-md border bg-muted/50 p-4">
                      <div className="flex items-start gap-3">
                        <Monitor className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                        <code className="text-sm font-mono break-all">
                          {sessionStats.userAgent}
                        </code>
                      </div>
                    </div>
                  </Section>
                )}

                {/* Messages 数据 */}
                {messages !== null && (
                  <Section
                    title={t("details.requestMessages")}
                    description={t("details.requestMessagesDescription")}
                  >
                    <div className="rounded-md border bg-muted/50 p-6 max-h-[600px] overflow-auto">
                      <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                        {JSON.stringify(messages, null, 2)}
                      </pre>
                    </div>
                  </Section>
                )}

                {/* Response Body */}
                {response !== null && (
                  <Section
                    title={t("details.responseBody")}
                    description={t("details.responseBodyDescription")}
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
                            {t("actions.copied")}
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-2" />
                            {t("actions.copyResponse")}
                          </>
                        )}
                      </Button>
                    }
                  >
                    <div className="rounded-md border bg-muted/50 p-6 max-h-[600px] overflow-auto">
                      <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                        {formatResponse(response)}
                      </pre>
                    </div>
                  </Section>
                )}

                {/* 无数据提示 */}
                {!sessionStats?.userAgent && !messages && !response && (
                  <div className="text-center py-16">
                    <div className="text-muted-foreground text-lg mb-2">
                      {t("details.noDetailedData")}
                    </div>
                    <p className="text-sm text-muted-foreground">{t("details.storageTip")}</p>
                  </div>
                )}
              </div>

              {/* 右侧：信息卡片（占 1 列）*/}
              {sessionStats && (
                <div className="space-y-4">
                  {/* Session 概览卡片 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t("details.overview")}</CardTitle>
                      <CardDescription>{t("details.overviewDescription")}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* 请求数量 */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {t("details.totalRequests")}
                        </span>
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
                              <span className="text-sm text-muted-foreground">
                                {t("details.firstRequest")}
                              </span>
                              <code className="text-xs font-mono">
                                {new Date(sessionStats.firstRequestAt).toLocaleString("zh-CN")}
                              </code>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">
                                {t("details.lastRequest")}
                              </span>
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
                            <span className="text-sm text-muted-foreground">
                              {t("details.totalDuration")}
                            </span>
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
                      <CardTitle className="text-base">{t("details.providersAndModels")}</CardTitle>
                      <CardDescription>
                        {t("details.providersAndModelsDescription")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* 供应商列表 */}
                      {sessionStats.providers.length > 0 && (
                        <div className="flex flex-col gap-2">
                          <span className="text-sm text-muted-foreground">
                            {t("details.providers")}
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {sessionStats.providers.map(
                              (provider: { id: number; name: string }) => (
                                <Badge key={provider.id} variant="outline" className="text-xs">
                                  {provider.name}
                                </Badge>
                              )
                            )}
                          </div>
                        </div>
                      )}

                      {/* 模型列表 */}
                      {sessionStats.models.length > 0 && (
                        <>
                          <div className="border-t my-3" />
                          <div className="flex flex-col gap-2">
                            <span className="text-sm text-muted-foreground">
                              {t("details.models")}
                            </span>
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
                      <CardTitle className="text-base">{t("details.tokenUsage")}</CardTitle>
                      <CardDescription>{t("details.tokenUsageDescription")}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {sessionStats.totalInputTokens > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            {t("details.totalInput")}
                          </span>
                          <code className="text-sm font-mono">
                            {sessionStats.totalInputTokens.toLocaleString()}
                          </code>
                        </div>
                      )}

                      {sessionStats.totalOutputTokens > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            {t("details.totalOutput")}
                          </span>
                          <code className="text-sm font-mono">
                            {sessionStats.totalOutputTokens.toLocaleString()}
                          </code>
                        </div>
                      )}

                      {sessionStats.totalCacheCreationTokens > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground flex items-center gap-2">
                            {t("details.cacheCreation")}
                            {sessionStats.cacheTtlApplied && (
                              <Badge variant="outline" className="text-xs">
                                {sessionStats.cacheTtlApplied === "mixed"
                                  ? t("details.cacheTtlMixed")
                                  : sessionStats.cacheTtlApplied}
                              </Badge>
                            )}
                          </span>
                          <code className="text-sm font-mono">
                            {sessionStats.totalCacheCreationTokens.toLocaleString()}
                          </code>
                        </div>
                      )}

                      {sessionStats.totalCacheReadTokens > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            {t("details.cacheRead")}
                          </span>
                          <code className="text-sm font-mono">
                            {sessionStats.totalCacheReadTokens.toLocaleString()}
                          </code>
                        </div>
                      )}

                      {totalTokens > 0 && (
                        <>
                          <div className="border-t my-3" />
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold">{t("details.total")}</span>
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
                        <CardTitle className="text-base">{t("details.costInfo")}</CardTitle>
                        <CardDescription>{t("details.costInfoDescription")}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            {t("details.totalFee")}
                          </span>
                          <code className="text-lg font-mono font-semibold text-green-600">
                            {formatCurrency(sessionStats.totalCostUsd, currencyCode, 6)}
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
      </div>

      {/* 终止 Session 确认对话框 */}
      <AlertDialog open={showTerminateDialog} onOpenChange={setShowTerminateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.terminateSessionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("actions.terminateSessionDescription")}
              <br />
              <code className="text-xs font-mono mt-2 block">{sessionId}</code>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isTerminating}>{t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleTerminateSession}
              disabled={isTerminating}
            >
              {isTerminating ? t("actions.terminating") : t("actions.confirmTerminate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
