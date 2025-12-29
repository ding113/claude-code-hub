"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { CodeDisplay } from "@/components/ui/code-display";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isSSEText } from "@/lib/utils/sse";

export type SessionMessages = Record<string, unknown> | Record<string, unknown>[];

function formatHeaders(headers: Record<string, string> | null): string | null {
  if (!headers || Object.keys(headers).length === 0) return null;
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

interface SessionMessagesDetailsTabsProps {
  messages: SessionMessages | null;
  requestHeaders: Record<string, string> | null;
  responseHeaders: Record<string, string> | null;
  response: string | null;
}

export function SessionMessagesDetailsTabs({
  messages,
  response,
  requestHeaders,
  responseHeaders,
}: SessionMessagesDetailsTabsProps) {
  const t = useTranslations("dashboard.sessions");
  const codeExpandedMaxHeight = "calc(100vh - 260px)";

  const requestBodyContent = useMemo(() => {
    if (messages === null) return null;
    return JSON.stringify(messages, null, 2);
  }, [messages]);

  const formattedRequestHeaders = useMemo(() => formatHeaders(requestHeaders), [requestHeaders]);
  const formattedResponseHeaders = useMemo(() => formatHeaders(responseHeaders), [responseHeaders]);

  const responseLanguage = response && isSSEText(response) ? "sse" : "json";

  return (
    <Tabs defaultValue="requestBody" className="w-full" data-testid="session-details-tabs">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="requestHeaders" data-testid="session-tab-trigger-request-headers">
          {t("details.requestHeaders")}
        </TabsTrigger>
        <TabsTrigger value="requestBody" data-testid="session-tab-trigger-request-body">
          {t("details.requestBody")}
        </TabsTrigger>
        <TabsTrigger value="responseHeaders" data-testid="session-tab-trigger-response-headers">
          {t("details.responseHeaders")}
        </TabsTrigger>
        <TabsTrigger value="responseBody" data-testid="session-tab-trigger-response-body">
          {t("details.responseBody")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="requestHeaders" data-testid="session-tab-request-headers">
        {formattedRequestHeaders === null ? (
          <div className="text-muted-foreground p-4">{t("details.noHeaders")}</div>
        ) : (
          <CodeDisplay
            content={formattedRequestHeaders}
            language="text"
            fileName="request.headers"
            maxHeight="600px"
            defaultExpanded
            expandedMaxHeight={codeExpandedMaxHeight}
          />
        )}
      </TabsContent>

      <TabsContent value="requestBody" data-testid="session-tab-request-body">
        {requestBodyContent === null ? (
          <div className="text-muted-foreground p-4">{t("details.noData")}</div>
        ) : (
          <CodeDisplay
            content={requestBodyContent}
            language="json"
            fileName="request.json"
            maxHeight="600px"
            defaultExpanded
            expandedMaxHeight={codeExpandedMaxHeight}
          />
        )}
      </TabsContent>

      <TabsContent value="responseHeaders" data-testid="session-tab-response-headers">
        {formattedResponseHeaders === null ? (
          <div className="text-muted-foreground p-4">{t("details.noHeaders")}</div>
        ) : (
          <CodeDisplay
            content={formattedResponseHeaders}
            language="text"
            fileName="response.headers"
            maxHeight="600px"
            defaultExpanded
            expandedMaxHeight={codeExpandedMaxHeight}
          />
        )}
      </TabsContent>

      <TabsContent value="responseBody" data-testid="session-tab-response-body">
        {response === null ? (
          <div className="text-muted-foreground p-4">{t("details.noData")}</div>
        ) : (
          <CodeDisplay
            content={response}
            language={responseLanguage}
            fileName={responseLanguage === "sse" ? "response.sse" : "response.json"}
            maxHeight="600px"
            defaultExpanded
            expandedMaxHeight={codeExpandedMaxHeight}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
