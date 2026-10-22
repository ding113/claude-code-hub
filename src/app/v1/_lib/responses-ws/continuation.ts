import { RESPONSES_WS_PRIOR_LOCAL_HEADER, verifyInternalRequest } from "./internal-secret";

export interface ResponsesWsSessionBinding {
  sessionId: string;
  generation: string;
  providerId: number;
  endpointId: number | null;
  upstreamUrl: string;
  fingerprint: string;
  connectionLocal: boolean;
  active: boolean;
}

export interface ResponsesWsOutcomeState {
  generation: string;
  connectionLocal: boolean;
  continuationError?: { code: "previous_response_not_found"; status: 400 | 409 };
}

const continuationBindings = new WeakMap<object, ResponsesWsSessionBinding>();
const responseOutcomes = new WeakMap<Response, ResponsesWsOutcomeState>();

function readHeader(headers: Headers | Record<string, string>, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

/** A prior local response remains local even when this turn changes `store`. */
export function isConnectionLocalResponsesWsRequest(
  headers: Headers | Record<string, string>,
  body: Record<string, unknown>
): boolean {
  return (
    readHeader(headers, "x-cch-client-transport")?.toLowerCase() === "websocket" &&
    verifyInternalRequest(headers) &&
    (body.store === false || readHeader(headers, RESPONSES_WS_PRIOR_LOCAL_HEADER) === "1")
  );
}

export function isConnectionLocalResponsesWsContinuation(
  headers: Headers | Record<string, string>,
  body: Record<string, unknown>
): boolean {
  return (
    isConnectionLocalResponsesWsRequest(headers, body) &&
    typeof body.previous_response_id === "string" &&
    body.previous_response_id.trim().length > 0
  );
}

export function getResponsesWsContinuationBinding(
  session: object
): ResponsesWsSessionBinding | undefined {
  return continuationBindings.get(session);
}

export function setResponsesWsContinuationBinding(
  session: object,
  binding: ResponsesWsSessionBinding
): void {
  continuationBindings.set(session, binding);
}

export function getResponsesWsOutcome(response: Response): ResponsesWsOutcomeState | undefined {
  return responseOutcomes.get(response);
}

export function attachResponsesWsOutcome(
  response: Response,
  state: ResponsesWsOutcomeState
): Response {
  responseOutcomes.set(response, state);
  return response;
}

/** Share mutable state so errors discovered while streaming reach every wrapper. */
export function copyResponsesWsOutcome(source: Response, target: Response): Response {
  const state = responseOutcomes.get(source);
  if (state) responseOutcomes.set(target, state);
  return target;
}
