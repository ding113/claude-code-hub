/**
 * WebSocket test result fields for provider testing UI.
 *
 * Designed to be composed into the existing test result data structure
 * without modifying the base ProviderTestResult type.
 */
export interface WsTestResultFields {
  wsSupported?: boolean;
  wsTransport?: "websocket" | "http_fallback" | "unsupported";
  wsHandshakeMs?: number;
  wsEventCount?: number;
  wsFallbackReason?: string;
  wsTerminalModel?: string;
}
