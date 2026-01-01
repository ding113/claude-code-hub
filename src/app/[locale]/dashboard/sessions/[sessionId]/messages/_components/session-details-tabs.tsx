"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { CodeDisplay } from "@/components/ui/code-display";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isSSEText } from "@/lib/utils/sse";

export type SessionMessages = Record<string, unknown> | Record<string, unknown>[];

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
  requestHeaders: Record<string, string> | null;
  responseHeaders: Record<string, string> | null;
  response: string | null;
  requestMeta: { clientUrl: string | null; upstreamUrl: string | null; method: string | null };
  responseMeta: { upstreamUrl: string | null; statusCode: number | null };
}

export function SessionMessagesDetailsTabs({
  requestBody,
  messages,
  response,
  requestHeaders,
  responseHeaders,
  requestMeta,
  responseMeta,
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

  return (
    <Tabs defaultValue="requestBody" className="w-full" data-testid="session-details-tabs">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="requestHeaders" data-testid="session-tab-trigger-request-headers">
          {t("details.requestHeaders")}
        </TabsTrigger>
        <TabsTrigger value="requestBody" data-testid="session-tab-trigger-request-body">
          {t("details.requestBody")}
        </TabsTrigger>
        <TabsTrigger value="requestMessages" data-testid="session-tab-trigger-request-messages">
          {t("details.requestMessages")}
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

      <TabsContent value="requestMessages" data-testid="session-tab-request-messages">
        {requestMessagesContent === null ? (
          <div className="text-muted-foreground p-4">{t("details.noData")}</div>
        ) : (
          <CodeDisplay
            content={requestMessagesContent}
            language="json"
            fileName="request.messages.json"
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
