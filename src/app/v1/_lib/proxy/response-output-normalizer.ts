import { logger } from "@/lib/logger";
import type { ProxySession } from "./session";

type JsonRecord = Record<string, unknown>;

export type ResponseOutputNormalizationResult = {
  payload: unknown;
  applied: boolean;
  fixes: string[];
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}

function cleanResponseHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers);
  cleaned.delete("transfer-encoding");
  cleaned.delete("content-length");
  cleaned.delete("content-encoding");
  return cleaned;
}

function stringifyArguments(value: unknown): string {
  if (value == null) return "{}";
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return String(value);
  }
}

function normalizeFunctionArguments(
  target: JsonRecord,
  key: string,
  fixes: string[],
  path: string
): void {
  if (!(key in target)) return;

  const value = target[key];
  const normalized = stringifyArguments(value);
  if (normalized === value) return;

  target[key] = normalized;
  fixes.push(`${path}.${key}`);
}

function normalizeContentPart(part: unknown, fixes: string[], path: string): void {
  if (!isRecord(part)) return;

  if ("text" in part && part.text === null) {
    part.text = "";
    fixes.push(`${path}.text`);
  }

  if ("annotations" in part && part.annotations === null) {
    part.annotations = [];
    fixes.push(`${path}.annotations`);
  }

  if ("logprobs" in part && part.logprobs === null) {
    part.logprobs = [];
    fixes.push(`${path}.logprobs`);
  }
}

function normalizeToolCall(toolCall: unknown, fixes: string[], path: string): void {
  if (!isRecord(toolCall)) return;

  const nestedFunction = toolCall.function;
  if (isRecord(nestedFunction)) {
    normalizeFunctionArguments(nestedFunction, "arguments", fixes, `${path}.function`);
  }
}

function normalizeOutputItem(item: unknown, fixes: string[], path: string): void {
  if (!isRecord(item)) return;

  // Responses API 的 message.content 是数组；部分兼容上游会把空内容写成 null。
  if ("content" in item) {
    if (item.content === null) {
      item.content = [];
      fixes.push(`${path}.content`);
    } else if (Array.isArray(item.content)) {
      item.content.forEach((part, index) => {
        normalizeContentPart(part, fixes, `${path}.content[${index}]`);
      });
    }
  }

  if ("summary" in item && item.summary === null) {
    item.summary = [];
    fixes.push(`${path}.summary`);
  }

  normalizeFunctionArguments(item, "arguments", fixes, path);

  const nestedFunction = item.function;
  if (isRecord(nestedFunction)) {
    normalizeFunctionArguments(nestedFunction, "arguments", fixes, `${path}.function`);
  }

  if (Array.isArray(item.tool_calls)) {
    item.tool_calls.forEach((toolCall, index) => {
      normalizeToolCall(toolCall, fixes, `${path}.tool_calls[${index}]`);
    });
  }
}

export function normalizeResponseOutputPayload(
  payload: unknown
): ResponseOutputNormalizationResult {
  const fixes: string[] = [];

  if (!isRecord(payload) || payload.object !== "response") {
    return { payload, applied: false, fixes };
  }

  if ("output" in payload) {
    if (payload.output === null) {
      payload.output = [];
      fixes.push("output");
    } else if (Array.isArray(payload.output)) {
      payload.output.forEach((item, index) => {
        normalizeOutputItem(item, fixes, `output[${index}]`);
      });
    }
  }

  if ("tools" in payload && payload.tools === null) {
    payload.tools = [];
    fixes.push("tools");
  }

  return { payload, applied: fixes.length > 0, fixes };
}

export async function normalizeResponseOutput(
  session: ProxySession,
  response: Response
): Promise<Response> {
  if (session.originalFormat !== "response") return response;
  if (response.status < 200 || response.status >= 300) return response;

  const contentType = response.headers.get("content-type") || "";
  if (!isJsonContentType(contentType)) return response;

  let rawText: string;
  try {
    rawText = await response.clone().text();
  } catch (error) {
    logger.warn("[ResponseOutputNormalizer] Failed to read response clone", {
      error: error instanceof Error ? error.message : String(error),
      sessionId: session.sessionId ?? null,
      requestSequence: session.requestSequence ?? null,
    });
    return response;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return response;
  }

  const result = normalizeResponseOutputPayload(parsed);
  if (!result.applied) return response;

  logger.info("[ResponseOutputNormalizer] Normalized Responses API output", {
    fixes: result.fixes,
    sessionId: session.sessionId ?? null,
    requestSequence: session.requestSequence ?? null,
  });

  return new Response(JSON.stringify(result.payload), {
    status: response.status,
    statusText: response.statusText,
    headers: cleanResponseHeaders(response.headers),
  });
}
