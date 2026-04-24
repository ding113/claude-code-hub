"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Braces,
  Check,
  Copy,
  Inbox,
  Info,
  MessageSquare,
  Settings2,
  Terminal,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { CodeDisplay } from "@/components/ui/code-display";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isSSEText } from "@/lib/utils/sse";
import type { SessionDetailSnapshots, SessionDetailViewMode } from "@/types/session";

export type SessionMessages = Record<string, unknown> | Record<string, unknown>[];

const SESSION_DETAILS_MAX_CONTENT_BYTES = 5_000_000;
const SESSION_DETAILS_MAX_LINES = 30_000;

function formatHeaders(
  headers: Record<string, string> | null,
  preambleLines?: string[]
): string | null {
  const normalizedPreamble = (preambleLines ?? []).map((line) => line.trim()).filter(Boolean);
  const preamble = normalizedPreamble.length > 0 ? normalizedPreamble.join("\n") : null;

  const headerLines =
    headers && Object.keys(headers).length > 0
      ? Object.entries(headers)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")
      : null;

  const combined = [preamble, headerLines].filter(Boolean).join("\n\n");
  return combined.length > 0 ? combined : null;
}

interface SessionMessagesDetailsTabsProps {
  snapshots: SessionDetailSnapshots | null;
  viewMode: SessionDetailViewMode;
  onViewModeChange: (mode: SessionDetailViewMode) => void;
  specialSettings: unknown | null;
  onCopyResponse?: () => void;
  isResponseCopied?: boolean;
}

export function SessionMessagesDetailsTabs({
  snapshots,
  viewMode,
  onViewModeChange,
  specialSettings,
  onCopyResponse,
  isResponseCopied,
}: SessionMessagesDetailsTabsProps) {
  const t = useTranslations("dashboard.sessions");
  const codeExpandedMaxHeight = "calc(var(--cch-viewport-height, 100vh) - 260px)";
  const clientLabel = t("details.snapshotSourceClient");
  const upstreamLabel = t("details.snapshotSourceUpstream");
  const requestSnapshot = snapshots?.request[viewMode] ?? null;
  const responseSnapshot = snapshots?.response[viewMode] ?? null;
  const requestBody = requestSnapshot?.body ?? null;
  const messages = requestSnapshot?.messages ?? null;
  const requestHeaders = requestSnapshot?.headers ?? null;
  const responseHeaders = responseSnapshot?.headers ?? null;
  const response = responseSnapshot?.body ?? null;
  const requestMeta = requestSnapshot?.meta ?? {
    clientUrl: null,
    upstreamUrl: null,
    method: null,
  };
  const responseMeta = responseSnapshot?.meta ?? {
    upstreamUrl: null,
    statusCode: null,
  };

  // 后端已根据 STORE_SESSION_MESSAGES 配置进行脱敏，前端直接显示
  const requestBodyContent = useMemo(() => {
    if (requestBody === null) return null;
    return JSON.stringify(requestBody, null, 2);
  }, [requestBody]);

  // 后端已根据 STORE_SESSION_MESSAGES 配置进行脱敏，前端直接显示
  const requestMessagesContent = useMemo(() => {
    if (messages === null) return null;
    return JSON.stringify(messages, null, 2);
  }, [messages]);

  const specialSettingsContent = useMemo(() => {
    if (specialSettings === null) return null;
    return JSON.stringify(specialSettings, null, 2);
  }, [specialSettings]);

  const requestHeadersPreamble = useMemo(() => {
    const lines: string[] = [];
    const method = requestMeta.method?.trim() || null;
    const label = viewMode === "before" ? clientLabel : upstreamLabel;
    const targetUrl = viewMode === "before" ? requestMeta.clientUrl : requestMeta.upstreamUrl;

    if (targetUrl) {
      lines.push(method ? `${label}: ${method} ${targetUrl}` : `${label}: ${targetUrl}`);
    }

    return lines;
  }, [
    clientLabel,
    requestMeta.clientUrl,
    requestMeta.method,
    requestMeta.upstreamUrl,
    upstreamLabel,
    viewMode,
  ]);

  const responseHeadersPreamble = useMemo(() => {
    const lines: string[] = [];

    if (viewMode === "before") {
      if (responseMeta.statusCode !== null && responseMeta.upstreamUrl) {
        lines.push(`${upstreamLabel}: HTTP ${responseMeta.statusCode} ${responseMeta.upstreamUrl}`);
        return lines;
      }
      if (responseMeta.statusCode !== null) {
        lines.push(`${upstreamLabel}: HTTP ${responseMeta.statusCode}`);
        return lines;
      }
      if (responseMeta.upstreamUrl) {
        lines.push(`${upstreamLabel}: ${responseMeta.upstreamUrl}`);
      }
      return lines;
    }

    if (responseMeta.statusCode !== null) {
      lines.push(`${clientLabel}: HTTP ${responseMeta.statusCode}`);
    }

    return lines;
  }, [clientLabel, responseMeta.statusCode, responseMeta.upstreamUrl, upstreamLabel, viewMode]);

  const formattedRequestHeaders = useMemo(
    () => formatHeaders(requestHeaders, requestHeadersPreamble),
    [requestHeaders, requestHeadersPreamble]
  );
  const formattedResponseHeaders = useMemo(
    () => formatHeaders(responseHeaders, responseHeadersPreamble),
    [responseHeaders, responseHeadersPreamble]
  );

  const responseLanguage = response && isSSEText(response) ? "sse" : "json";
  const requestMessagesEmptyMessage =
    viewMode === "after" && requestSnapshot !== null && requestBodyContent !== null
      ? t("details.afterRequestMessagesEmpty", {
          requestBodyLabel: t("details.requestBody"),
        })
      : t("details.storageTip");

  // Reusable Empty State Component
  const EmptyState = ({ message }: { message: string }) => (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground bg-muted/20 rounded-lg border border-dashed text-center px-4">
      <Inbox className="h-10 w-10 mb-3 opacity-20" />
      <p className="text-sm max-w-lg">{message}</p>
    </div>
  );

  return (
    <Tabs
      defaultValue="requestBody"
      className="w-full space-y-4"
      data-testid="session-details-tabs"
    >
      {/* Scrollable Tabs List with Action Button */}
      <div className="w-full flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <TabsList className="w-max inline-flex h-auto p-1 items-center justify-start gap-1 bg-muted/50 rounded-lg">
          <TabsTrigger
            value="requestHeaders"
            className="gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            data-testid="session-tab-trigger-request-headers"
          >
            <ArrowUpRight className="h-4 w-4" />
            <span className="whitespace-nowrap">{t("details.requestHeaders")}</span>
          </TabsTrigger>

          <TabsTrigger
            value="requestBody"
            className="gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            data-testid="session-tab-trigger-request-body"
          >
            <Braces className="h-4 w-4" />
            <span className="whitespace-nowrap">{t("details.requestBody")}</span>
          </TabsTrigger>

          <TabsTrigger
            value="requestMessages"
            className="gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            data-testid="session-tab-trigger-request-messages"
          >
            <MessageSquare className="h-4 w-4" />
            <span className="whitespace-nowrap">{t("details.requestMessages")}</span>
          </TabsTrigger>

          <TabsTrigger
            value="specialSettings"
            className="gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            data-testid="session-tab-trigger-special-settings"
          >
            <Settings2 className="h-4 w-4" />
            <span className="whitespace-nowrap">{t("details.specialSettings")}</span>
          </TabsTrigger>

          <div className="mx-1 w-px h-5 bg-border hidden sm:block" />

          <TabsTrigger
            value="responseHeaders"
            className="gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            data-testid="session-tab-trigger-response-headers"
          >
            <ArrowDownLeft className="h-4 w-4" />
            <span className="whitespace-nowrap">{t("details.responseHeaders")}</span>
          </TabsTrigger>

          <TabsTrigger
            value="responseBody"
            className="gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            data-testid="session-tab-trigger-response-body"
          >
            <Terminal className="h-4 w-4" />
            <span className="whitespace-nowrap">{t("details.responseBody")}</span>
          </TabsTrigger>
        </TabsList>

        <div
          className="inline-flex items-center rounded-lg border bg-background p-1 shrink-0"
          role="group"
          aria-label={t("details.viewMode")}
        >
          <Button
            type="button"
            variant={viewMode === "before" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-3"
            aria-pressed={viewMode === "before"}
            data-testid="session-view-mode-before"
            onClick={() => onViewModeChange("before")}
          >
            {t("details.before")}
          </Button>
          <Button
            type="button"
            variant={viewMode === "after" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-3"
            aria-pressed={viewMode === "after"}
            data-testid="session-view-mode-after"
            onClick={() => onViewModeChange("after")}
          >
            {t("details.after")}
          </Button>
        </div>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                data-testid="session-view-mode-tooltip-trigger"
                aria-label={t("details.viewModeTooltipLabel")}
              >
                <Info className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm text-xs leading-5">
              {t("details.viewModeTooltip")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Copy Response Button */}
        {responseSnapshot?.body && onCopyResponse && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-9 px-3 gap-2 bg-background border-dashed text-muted-foreground hover:text-foreground shrink-0"
                  onClick={onCopyResponse}
                >
                  {isResponseCopied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  <span className="text-xs font-medium">
                    {isResponseCopied ? t("actions.copied") : t("actions.copyResponse")}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("actions.copyResponse")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="border rounded-lg bg-card text-card-foreground shadow-sm overflow-hidden">
        <TabsContent
          value="requestHeaders"
          className="m-0 focus-visible:outline-none"
          data-testid="session-tab-request-headers"
        >
          {formattedRequestHeaders === null ? (
            <EmptyState message={t("details.storageTip")} />
          ) : (
            <CodeDisplay
              content={formattedRequestHeaders}
              language="text"
              fileName="request.headers"
              maxContentBytes={SESSION_DETAILS_MAX_CONTENT_BYTES}
              maxLines={SESSION_DETAILS_MAX_LINES}
              maxHeight="600px"
              defaultExpanded
              expandedMaxHeight={codeExpandedMaxHeight}
              className="border-0 rounded-none"
            />
          )}
        </TabsContent>

        <TabsContent
          value="requestBody"
          className="m-0 focus-visible:outline-none"
          data-testid="session-tab-request-body"
        >
          {requestBodyContent === null ? (
            <EmptyState message={t("details.storageTip")} />
          ) : (
            <CodeDisplay
              content={requestBodyContent}
              language="json"
              fileName="request.json"
              maxContentBytes={SESSION_DETAILS_MAX_CONTENT_BYTES}
              maxLines={SESSION_DETAILS_MAX_LINES}
              maxHeight="600px"
              defaultExpanded
              expandedMaxHeight={codeExpandedMaxHeight}
              className="border-0 rounded-none"
            />
          )}
        </TabsContent>

        <TabsContent
          value="requestMessages"
          className="m-0 focus-visible:outline-none"
          data-testid="session-tab-request-messages"
        >
          {requestMessagesContent === null ? (
            <EmptyState message={requestMessagesEmptyMessage} />
          ) : (
            <CodeDisplay
              content={requestMessagesContent}
              language="json"
              fileName="request.messages.json"
              maxContentBytes={SESSION_DETAILS_MAX_CONTENT_BYTES}
              maxLines={SESSION_DETAILS_MAX_LINES}
              maxHeight="600px"
              defaultExpanded
              expandedMaxHeight={codeExpandedMaxHeight}
              className="border-0 rounded-none"
            />
          )}
        </TabsContent>

        <TabsContent
          value="specialSettings"
          className="m-0 focus-visible:outline-none"
          data-testid="session-tab-special-settings"
        >
          <div className="border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
            {t("details.specialSettingsStaticNote")}
          </div>
          <div>
            {specialSettingsContent === null ? (
              <EmptyState message={t("details.specialSettingsEmpty")} />
            ) : (
              <CodeDisplay
                content={specialSettingsContent}
                language="json"
                fileName="specialSettings.json"
                maxContentBytes={SESSION_DETAILS_MAX_CONTENT_BYTES}
                maxLines={SESSION_DETAILS_MAX_LINES}
                maxHeight="600px"
                defaultExpanded
                expandedMaxHeight={codeExpandedMaxHeight}
                className="border-0 rounded-none"
              />
            )}
          </div>
        </TabsContent>

        <TabsContent
          value="responseHeaders"
          className="m-0 focus-visible:outline-none"
          data-testid="session-tab-response-headers"
        >
          {formattedResponseHeaders === null ? (
            <EmptyState message={t("details.storageTip")} />
          ) : (
            <CodeDisplay
              content={formattedResponseHeaders}
              language="text"
              fileName="response.headers"
              maxContentBytes={SESSION_DETAILS_MAX_CONTENT_BYTES}
              maxLines={SESSION_DETAILS_MAX_LINES}
              maxHeight="600px"
              defaultExpanded
              expandedMaxHeight={codeExpandedMaxHeight}
              className="border-0 rounded-none"
            />
          )}
        </TabsContent>

        <TabsContent
          value="responseBody"
          className="m-0 focus-visible:outline-none"
          data-testid="session-tab-response-body"
        >
          {response === null ? (
            <EmptyState message={t("details.storageTip")} />
          ) : (
            <CodeDisplay
              content={response}
              language={responseLanguage}
              fileName={responseLanguage === "sse" ? "response.sse" : "response.json"}
              maxContentBytes={SESSION_DETAILS_MAX_CONTENT_BYTES}
              maxLines={SESSION_DETAILS_MAX_LINES}
              maxHeight="600px"
              defaultExpanded
              expandedMaxHeight={codeExpandedMaxHeight}
              className="border-0 rounded-none"
            />
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}
