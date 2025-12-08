"use client";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Copy, Eye, EyeOff, ListPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { getProxyStatus } from "@/actions/proxy-status";
import { FormErrorBoundary } from "@/components/form-error-boundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { copyToClipboard, isClipboardSupported } from "@/lib/utils/clipboard";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import { formatDate, formatDateDistance } from "@/lib/utils/date-format";
import type { ProxyStatusResponse } from "@/types/proxy-status";
import type { User, UserDisplay } from "@/types/user";
import { AddKeyForm } from "./forms/add-key-form";
import { UserActions } from "./user-actions";

const PROXY_STATUS_REFRESH_INTERVAL = 2000;

async function fetchProxyStatus(): Promise<ProxyStatusResponse> {
  const result = await getProxyStatus();
  if (result.ok) {
    if (result.data) {
      return result.data;
    }
    throw new Error("Failed to fetch proxy status");
  }
  throw new Error(result.error || "Failed to fetch proxy status");
}

function createFormatRelativeTime(t: (key: string, params?: Record<string, number>) => string) {
  return (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    if (diff <= 0) {
      return t("proxyStatus.timeAgo.justNow");
    }

    const seconds = Math.floor(diff / 1000);
    if (seconds < 5) {
      return t("proxyStatus.timeAgo.justNow");
    }
    if (seconds < 60) {
      return t("proxyStatus.timeAgo.secondsAgo", { count: seconds });
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return t("proxyStatus.timeAgo.minutesAgo", { count: minutes });
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return t("proxyStatus.timeAgo.hoursAgo", { count: hours });
    }

    const days = Math.floor(hours / 24);
    if (days < 7) {
      return t("proxyStatus.timeAgo.daysAgo", { count: days });
    }

    return new Date(timestamp).toLocaleDateString();
  };
}

function StatusSpinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 animate-spin rounded-full border border-muted-foreground/70 border-t-transparent"
    />
  );
}

interface KeyListHeaderProps {
  activeUser: UserDisplay | null;
  currentUser?: User;
  currencyCode?: CurrencyCode;
}

export function KeyListHeader({
  activeUser,
  currentUser,
  currencyCode = "USD",
}: KeyListHeaderProps) {
  const [openAdd, setOpenAdd] = useState(false);
  const [keyResult, setKeyResult] = useState<{ generatedKey: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [clipboardAvailable, setClipboardAvailable] = useState(false);
  const t = useTranslations("dashboard.keyListHeader");
  const tUsers = useTranslations("users");
  const locale = useLocale();

  // 检测 clipboard 是否可用
  useEffect(() => {
    setClipboardAvailable(isClipboardSupported());
  }, []);

  const totalTodayUsage =
    activeUser?.keys.reduce((sum, key) => sum + (key.todayUsage ?? 0), 0) ?? 0;

  const formatRelativeTime = useMemo(() => createFormatRelativeTime(t), [t]);

  // 获取用户状态和过期信息
  const userStatusInfo = useMemo(() => {
    if (!activeUser) return null;

    const now = Date.now();
    const exp = activeUser.expiresAt ? new Date(activeUser.expiresAt).getTime() : null;

    let status: {
      code: string;
      badge: string;
      variant: "default" | "secondary" | "destructive" | "outline";
    };

    if (!activeUser.isEnabled) {
      status = { code: "disabled", badge: "已禁用", variant: "secondary" };
    } else if (exp && exp <= now) {
      status = { code: "expired", badge: "已过期", variant: "destructive" };
    } else if (exp && exp - now <= 72 * 60 * 60 * 1000) {
      status = { code: "expiringSoon", badge: "即将过期", variant: "outline" };
    } else {
      status = { code: "active", badge: "已启用", variant: "default" };
    }

    const expiryText = activeUser.expiresAt
      ? `${formatDateDistance(activeUser.expiresAt, new Date(), locale, { addSuffix: true })} (${formatDate(activeUser.expiresAt, "yyyy-MM-dd", locale)})`
      : tUsers("neverExpires");

    return { status, expiryText };
  }, [activeUser, locale, tUsers]);

  const proxyStatusEnabled = Boolean(activeUser);
  const {
    data: proxyStatus,
    error: proxyStatusError,
    isLoading: proxyStatusLoading,
  } = useQuery<ProxyStatusResponse, Error>({
    queryKey: ["proxy-status"],
    queryFn: fetchProxyStatus,
    refetchInterval: PROXY_STATUS_REFRESH_INTERVAL,
    enabled: proxyStatusEnabled,
  });

  const activeUserStatus = useMemo(() => {
    if (!proxyStatus || !activeUser) {
      return null;
    }
    return proxyStatus.users.find((user) => user.userId === activeUser.id) ?? null;
  }, [proxyStatus, activeUser]);

  const proxyStatusContent = useMemo(() => {
    if (!proxyStatusEnabled) {
      return null;
    }

    if (proxyStatusLoading) {
      return (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>{t("proxyStatus.loading")}</span>
          <StatusSpinner />
        </div>
      );
    }

    if (proxyStatusError) {
      return <div className="text-xs text-destructive">{t("proxyStatus.fetchFailed")}</div>;
    }

    if (!activeUserStatus) {
      return <div className="text-xs text-muted-foreground">{t("proxyStatus.noStatus")}</div>;
    }

    const activeProviders = Array.from(
      new Set(activeUserStatus.activeRequests.map((request) => request.providerName))
    );

    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <span>{t("proxyStatus.activeRequests")}</span>
          <span className="font-medium text-foreground">{activeUserStatus.activeCount}</span>
          {activeProviders.length > 0 && (
            <span className="text-muted-foreground">（{activeProviders.join("、")}）</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span>{t("proxyStatus.lastRequest")}</span>
          <span className="text-foreground">
            {activeUserStatus.lastRequest
              ? `${activeUserStatus.lastRequest.providerName} / ${activeUserStatus.lastRequest.model}`
              : t("proxyStatus.noRecord")}
          </span>
          {activeUserStatus.lastRequest && (
            <span className="text-muted-foreground">
              · {formatRelativeTime(activeUserStatus.lastRequest.endTime)}
            </span>
          )}
        </div>
      </div>
    );
  }, [
    proxyStatusEnabled,
    proxyStatusLoading,
    proxyStatusError,
    activeUserStatus,
    t,
    formatRelativeTime,
  ]);

  const handleKeyCreated = (result: { generatedKey: string; name: string }) => {
    setOpenAdd(false); // 关闭表单dialog
    setKeyResult(result); // 显示成功dialog
  };

  const handleCopy = async () => {
    if (!keyResult) return;
    const success = await copyToClipboard(keyResult.generatedKey);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCloseSuccess = () => {
    setKeyResult(null);
    setCopied(false);
    setKeyVisible(false);
  };

  // 权限检查：管理员可以给所有人添加Key，普通用户只能给自己添加Key
  const canAddKey =
    currentUser && activeUser && (currentUser.role === "admin" || currentUser.id === activeUser.id);

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <span>{activeUser ? activeUser.name : "-"}</span>
            {activeUser && userStatusInfo && (
              <Badge variant={userStatusInfo.status.variant} className="text-xs">
                {userStatusInfo.status.badge}
              </Badge>
            )}
            {activeUser && <UserActions user={activeUser} currentUser={currentUser} />}
          </div>
          <div className="mt-1">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <div>
                {t("todayUsage")} {activeUser ? formatCurrency(totalTodayUsage, currencyCode) : "-"}{" "}
                / {activeUser ? formatCurrency(activeUser.dailyQuota, currencyCode) : "-"}
              </div>
              {activeUser && userStatusInfo && (
                <div className="flex items-center gap-1">
                  <span>过期时间:</span>
                  <span className="text-foreground">{userStatusInfo.expiryText}</span>
                </div>
              )}
              {proxyStatusContent}
            </div>
          </div>
        </div>
        {canAddKey && (
          <Dialog open={openAdd} onOpenChange={setOpenAdd}>
            <DialogTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="hover:bg-primary hover:text-primary-foreground cursor-pointer transition-colors"
                disabled={!activeUser}
              >
                <ListPlus className="h-3.5 w-3.5" /> {t("addKey")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[80vh] flex flex-col overflow-y-auto">
              <FormErrorBoundary>
                <AddKeyForm
                  userId={activeUser?.id}
                  user={
                    activeUser
                      ? {
                          id: activeUser.id,
                          name: activeUser.name,
                          description: activeUser.note || "",
                          role: activeUser.role,
                          rpm: activeUser.rpm,
                          dailyQuota: activeUser.dailyQuota,
                          providerGroup: activeUser.providerGroup || null,
                          createdAt: new Date(),
                          updatedAt: new Date(),
                          limit5hUsd: activeUser.limit5hUsd ?? undefined,
                          limitWeeklyUsd: activeUser.limitWeeklyUsd ?? undefined,
                          limitMonthlyUsd: activeUser.limitMonthlyUsd ?? undefined,
                          limitConcurrentSessions: activeUser.limitConcurrentSessions ?? undefined,
                          isEnabled: activeUser.isEnabled,
                          expiresAt: activeUser.expiresAt ?? undefined,
                        }
                      : undefined
                  }
                  onSuccess={handleKeyCreated}
                />
              </FormErrorBoundary>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Key创建成功弹窗 */}
      <Dialog open={!!keyResult} onOpenChange={(open) => !open && handleCloseSuccess()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              {t("keyCreatedDialog.title")}
            </DialogTitle>
            <DialogDescription>{t("keyCreatedDialog.description")}</DialogDescription>
          </DialogHeader>

          {keyResult && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  {t("keyCreatedDialog.apiKeyLabel")}
                </label>
                <div className="relative">
                  <div
                    className={`p-3 bg-muted/50 rounded-md font-mono text-sm break-all border-2 border-dashed border-orange-300 pr-12 ${keyVisible ? "select-all" : ""}`}
                  >
                    {clipboardAvailable || keyVisible
                      ? keyResult.generatedKey
                      : "••••••••••••••••••••••••••••••"}
                  </div>
                  {clipboardAvailable ? (
                    // HTTPS 环境：显示复制按钮
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopy}
                      className="absolute top-1/2 right-2 -translate-y-1/2 h-7 w-7 p-0"
                      title={t("keyCreatedDialog.copyTooltip")}
                    >
                      {copied ? (
                        <CheckCircle className="h-3 w-3 text-orange-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  ) : (
                    // HTTP 环境：显示显示/隐藏按钮
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setKeyVisible(!keyVisible)}
                      className="absolute top-1/2 right-2 -translate-y-1/2 h-7 w-7 p-0"
                      title={
                        keyVisible
                          ? t("keyCreatedDialog.hideTooltip")
                          : t("keyCreatedDialog.showTooltip")
                      }
                    >
                      {keyVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {clipboardAvailable
                    ? t("keyCreatedDialog.warningText")
                    : t("keyCreatedDialog.httpWarningText")}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={handleCloseSuccess} variant="secondary">
              {t("keyCreatedDialog.closeButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
