"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Braces,
  Check,
  Copy,
  Inbox,
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
  requestBody: unknown | null;
  messages: SessionMessages | null;
  specialSettings: unknown | null;
  requestHeaders: Record<string, string> | null;
  responseHeaders: Record<string, string> | null;
  response: string | null;
  requestMeta: { clientUrl: string | null; upstreamUrl: string | null; method: string | null };
  responseMeta: { upstreamUrl: string | null; statusCode: number | null };
  onCopyResponse?: () => void;
  isResponseCopied?: boolean;
}

export function SessionMessagesDetailsTabs({
  requestBody,
  messages,
  specialSettings,
  response,
  requestHeaders,
  responseHeaders,
  requestMeta,
  responseMeta,
  onCopyResponse,
  isResponseCopied,
}: SessionMessagesDetailsTabsProps) {
  const t = useTranslations("dashboard.sessions");
  const codeExpandedMaxHeight = "calc(100vh - 260px)";

  const requestBodyContent = useMemo(() => {
    if (requestBody === null) return null;
    return JSON.stringify(requestBody, null, 2);
  }, [requestBody]);

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

    if (requestMeta.upstreamUrl) {
      lines.push(
        method
          ? `UPSTREAM: ${method} ${requestMeta.upstreamUrl}`
          : `UPSTREAM: ${requestMeta.upstreamUrl}`
      );
    }
    if (requestMeta.clientUrl) {
      lines.push(
        method ? `CLIENT: ${method} ${requestMeta.clientUrl}` : `CLIENT: ${requestMeta.clientUrl}`
      );
    }

    return lines;
  }, [requestMeta.clientUrl, requestMeta.method, requestMeta.upstreamUrl]);

  const responseHeadersPreamble = useMemo(() => {
    const lines: string[] = [];

    if (responseMeta.statusCode !== null && responseMeta.upstreamUrl) {
      lines.push(`UPSTREAM: HTTP ${responseMeta.statusCode} ${responseMeta.upstreamUrl}`);
      return lines;
    }
    if (responseMeta.statusCode !== null) {
      lines.push(`UPSTREAM: HTTP ${responseMeta.statusCode}`);
      return lines;
    }
    if (responseMeta.upstreamUrl) {
      lines.push(`UPSTREAM: ${responseMeta.upstreamUrl}`);
    }

    return lines;
  }, [responseMeta.statusCode, responseMeta.upstreamUrl]);

  const formattedRequestHeaders = useMemo(
    () => formatHeaders(requestHeaders, requestHeadersPreamble),
    [requestHeaders, requestHeadersPreamble]
  );
  const formattedResponseHeaders = useMemo(
    () => formatHeaders(responseHeaders, responseHeadersPreamble),
    [responseHeaders, responseHeadersPreamble]
  );

  const responseLanguage = response && isSSEText(response) ? "sse" : "json";

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

        {/* Copy Response Button */}
        {response && onCopyResponse && (
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
            <EmptyState message={t("details.storageTip")} />
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
          {specialSettingsContent === null ? (
            <EmptyState message={t("details.noData")} />
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
