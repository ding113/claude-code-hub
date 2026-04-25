/**
 * Decides whether a request forwarded by the proxy should attempt an OpenAI
 * Responses WebSocket connection to the upstream. Returns a small discriminated
 * result so the forwarder can both (a) decide whether to call the adapter and
 * (b) record a structured downgrade reason on the decision chain when it
 * declines.
 *
 * Eligibility requires ALL of:
 *   - request entered CCH via a WebSocket (`x-cch-client-transport: websocket`
 *     header injected by the custom Node server)
 *   - provider type is `codex`
 *   - global `enableOpenaiResponsesWebsocket` setting is on
 *   - the specific provider/endpoint is NOT in the short-TTL unsupported cache
 */

import { isOpenaiResponsesWebsocketEnabled } from "@/lib/config/system-settings-cache";
import type { Provider } from "@/types/provider";
import { isResponsesWsUnsupported } from "./unsupported-cache";

export const CLIENT_TRANSPORT_HEADER = "x-cch-client-transport";

export type ResponsesWsDowngradeReason =
  | "setting_disabled"
  | "provider_not_codex"
  | "endpoint_ws_unsupported_cached"
  | "ws_not_yet_implemented";

export interface ResponsesWsEligibility {
  isWebsocketClient: boolean;
  eligible: boolean;
  downgradeReason?: ResponsesWsDowngradeReason;
  endpointId?: number | null;
}

export function isWebsocketClientRequest(headers: Headers | Record<string, string>): boolean {
  const value =
    headers instanceof Headers
      ? headers.get(CLIENT_TRANSPORT_HEADER)
      : (headers[CLIENT_TRANSPORT_HEADER] as string | undefined);
  return typeof value === "string" && value.toLowerCase() === "websocket";
}

export async function evaluateResponsesWsEligibility(options: {
  headers: Headers | Record<string, string>;
  provider: Provider;
  endpointId?: number | null;
}): Promise<ResponsesWsEligibility> {
  const websocketClient = isWebsocketClientRequest(options.headers);
  if (!websocketClient) {
    return { isWebsocketClient: false, eligible: false };
  }

  if (options.provider.providerType !== "codex") {
    return {
      isWebsocketClient: true,
      eligible: false,
      downgradeReason: "provider_not_codex",
      endpointId: options.endpointId ?? null,
    };
  }

  const settingEnabled = await isOpenaiResponsesWebsocketEnabled();
  if (!settingEnabled) {
    return {
      isWebsocketClient: true,
      eligible: false,
      downgradeReason: "setting_disabled",
      endpointId: options.endpointId ?? null,
    };
  }

  const cache = isResponsesWsUnsupported(options.provider.id, options.endpointId);
  if (cache.unsupported) {
    return {
      isWebsocketClient: true,
      eligible: false,
      downgradeReason: "endpoint_ws_unsupported_cached",
      endpointId: options.endpointId ?? null,
    };
  }

  return {
    isWebsocketClient: true,
    eligible: true,
    endpointId: options.endpointId ?? null,
  };
}
