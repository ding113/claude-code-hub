"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { WsTestResultFields } from "@/lib/provider-testing/ws-types";

interface WsTestStatusProps {
  result: WsTestResultFields;
}

/**
 * Inline WebSocket status section for the provider test result card.
 *
 * Renders transport badge (WS / HTTP Fallback / Unsupported),
 * handshake latency, event count, and fallback reason.
 *
 * Returns null when no WS-related fields are present.
 */
export function WsTestStatus({ result }: WsTestStatusProps) {
  const t = useTranslations("settings.providers.form.apiTest");

  // Nothing to show if no WS data at all
  const hasWsData = result.wsSupported !== undefined || result.wsTransport !== undefined;
  if (!hasWsData) return null;

  return (
    <div data-testid="ws-test-status" className="mt-3 p-3 rounded-md border bg-muted/30">
      {/* Header: title + transport badge */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-muted-foreground">{t("ws.status")}</span>
        <TransportBadge transport={result.wsTransport} t={t} />
      </div>

      {/* Metrics row */}
      {(result.wsHandshakeMs !== undefined || result.wsEventCount !== undefined) && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {result.wsHandshakeMs !== undefined && (
            <div data-testid="ws-handshake">
              <span className="text-muted-foreground">{t("ws.handshakeMs")}:</span>{" "}
              <span className="font-medium">{result.wsHandshakeMs}ms</span>
            </div>
          )}
          {result.wsEventCount !== undefined && (
            <div data-testid="ws-event-count">
              <span className="text-muted-foreground">{t("ws.eventCount")}:</span>{" "}
              <span className="font-medium">{result.wsEventCount}</span>
            </div>
          )}
        </div>
      )}

      {/* Fallback reason */}
      {result.wsFallbackReason && (
        <div data-testid="ws-fallback-reason" className="mt-2 text-xs">
          <span className="text-muted-foreground">{t("ws.fallbackReason")}:</span>{" "}
          <span className="text-destructive">{result.wsFallbackReason}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Transport badge with color-coded variant.
 */
function TransportBadge({
  transport,
  t,
}: {
  transport: WsTestResultFields["wsTransport"];
  t: ReturnType<typeof useTranslations>;
}) {
  switch (transport) {
    case "websocket":
      return (
        <Badge data-testid="ws-badge" variant="default">
          {t("ws.supported")}
        </Badge>
      );
    case "http_fallback":
      return (
        <Badge data-testid="ws-badge" variant="secondary">
          {t("ws.fallback")}
        </Badge>
      );
    case "unsupported":
      return (
        <Badge data-testid="ws-badge" variant="destructive">
          {t("ws.unsupported")}
        </Badge>
      );
    default:
      return null;
  }
}
