import type { ClientFrame, ServerErrorFrame, TerminalEvent } from "./frames";
import {
  ClientFrameSchema,
  ServerErrorFrameSchema,
  TERMINAL_EVENT_TYPES,
  TerminalEventSchema,
} from "./frames";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Client frame parsing
// ---------------------------------------------------------------------------

/**
 * Parse and validate an incoming client WebSocket message.
 * Accepts a raw string or Buffer and returns a structured error on invalid
 * JSON or schema violation.
 */
export function parseClientFrame(raw: string | Buffer): ParseResult<ClientFrame> {
  let json: unknown;
  try {
    const text = typeof raw === "string" ? raw : raw.toString("utf-8");
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }

  const result = ClientFrameSchema.safeParse(json);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  const firstIssue = result.error.issues[0];
  const message = firstIssue
    ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
    : "Schema validation failed";
  return { ok: false, error: message };
}

// ---------------------------------------------------------------------------
// Server event helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a server event type string is terminal
 * (response.completed / response.failed / response.incomplete).
 */
export function isTerminalEvent(eventType: string): boolean {
  return (TERMINAL_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Parse a server event payload as a terminal event if it matches the schema.
 */
export function parseTerminalEvent(data: unknown): ParseResult<TerminalEvent> {
  const result = TerminalEventSchema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  const firstIssue = result.error.issues[0];
  const message = firstIssue
    ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
    : "Terminal event validation failed";
  return { ok: false, error: message };
}

/**
 * Parse a server error frame.
 */
export function parseServerError(data: unknown): ParseResult<ServerErrorFrame> {
  const result = ServerErrorFrameSchema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  const firstIssue = result.error.issues[0];
  const message = firstIssue
    ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
    : "Server error validation failed";
  return { ok: false, error: message };
}
