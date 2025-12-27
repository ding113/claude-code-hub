"use client";

import { useTranslations } from "next-intl";
import { CodeDisplay } from "@/components/ui/code-display";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isSSEText } from "@/lib/utils/sse";

export type SessionMessages = Record<string, unknown> | Record<string, unknown>[];

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

  const formatHeaders = (headers: Record<string, string>) => {
    return Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  };

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
        {!requestHeaders || Object.keys(requestHeaders).length === 0 ? (
          <div className="text-muted-foreground p-4">{t("details.noHeaders")}</div>
        ) : (
          <CodeDisplay
            content={formatHeaders(requestHeaders)}
            language="text"
            fileName="request.headers"
            maxHeight="600px"
          />
        )}
      </TabsContent>

      <TabsContent value="requestBody" data-testid="session-tab-request-body">
        {messages === null ? (
          <div className="text-muted-foreground p-4">{t("details.noData")}</div>
        ) : (
          <CodeDisplay
            content={JSON.stringify(messages, null, 2)}
            language="json"
            fileName="request.json"
            maxHeight="600px"
          />
        )}
      </TabsContent>

      <TabsContent value="responseHeaders" data-testid="session-tab-response-headers">
        {!responseHeaders || Object.keys(responseHeaders).length === 0 ? (
          <div className="text-muted-foreground p-4">{t("details.noHeaders")}</div>
        ) : (
          <CodeDisplay
            content={formatHeaders(responseHeaders)}
            language="text"
            fileName="response.headers"
            maxHeight="600px"
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
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
