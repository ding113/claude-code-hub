import { isSSEText, parseSSEData } from "@/lib/utils/sse";

export const LANGFUSE_FINAL_OUTPUT_MAX_SERIALIZED_CHARS = 1024 * 1024;
export const STREAM_ACCUMULATOR_TRUNCATED_MARKER = "\n\n: [cch_truncated]\n\n";

const STREAM_FINAL_OUTPUT_REASONS = [
  "accumulator_truncated",
  "malformed_frame",
  "empty_stream",
  "stream_error",
  "over_budget",
  "unsupported_framing",
  "no_terminal_event",
] as const;

export type StreamFinalOutputUnavailableReason = (typeof STREAM_FINAL_OUTPUT_REASONS)[number];

export type StreamFraming = "sse" | "ndjson" | "json-array";

export type StreamFrame = {
  readonly framing: StreamFraming;
  readonly event: string | null;
  readonly data: unknown;
};

export type ParsedStreamFrames = {
  readonly kind: "frames";
  readonly framing: StreamFraming;
  readonly frames: readonly StreamFrame[];
};

export type StreamFinalOutputDiagnosticMetadata = {
  readonly eventCount?: number;
  readonly status?: number | null;
  readonly framing?: StreamFraming;
  readonly serializedBytes?: number;
  readonly maxSerializedBytes?: number;
};

export type StreamFinalOutputDiagnostic = {
  readonly kind: "final_output_unavailable";
  readonly reason: StreamFinalOutputUnavailableReason;
  readonly eventCount: number;
  readonly status?: number | null;
  readonly framing?: StreamFraming;
  readonly serializedBytes?: number;
  readonly maxSerializedBytes?: number;
};

export type StreamFinalOutput =
  | { readonly kind: "final"; readonly value: unknown }
  | StreamFinalOutputDiagnostic;

export type ParseStreamFramesResult = ParsedStreamFrames | StreamFinalOutputDiagnostic;

export function createFinalOutputUnavailable(
  reason: StreamFinalOutputUnavailableReason,
  metadata: StreamFinalOutputDiagnosticMetadata = {}
): StreamFinalOutputDiagnostic {
  const diagnostic: StreamFinalOutputDiagnostic = {
    kind: "final_output_unavailable",
    reason,
    eventCount: metadata.eventCount ?? 0,
  };

  return {
    ...diagnostic,
    ...(metadata.status !== undefined ? { status: metadata.status } : {}),
    ...(metadata.framing !== undefined ? { framing: metadata.framing } : {}),
    ...(metadata.serializedBytes !== undefined
      ? { serializedBytes: metadata.serializedBytes }
      : {}),
    ...(metadata.maxSerializedBytes !== undefined
      ? { maxSerializedBytes: metadata.maxSerializedBytes }
      : {}),
  };
}

export function parseStreamFrames(streamText: string): ParseStreamFramesResult {
  if (streamText.includes(STREAM_ACCUMULATOR_TRUNCATED_MARKER)) {
    return createFinalOutputUnavailable("accumulator_truncated");
  }

  const trimmedText = streamText.trim();
  if (trimmedText.length === 0) {
    return createFinalOutputUnavailable("empty_stream");
  }

  if (isSSEText(streamText)) {
    return parseSSEFrames(streamText);
  }

  if (trimmedText.startsWith("[")) {
    return parseJsonArrayFrames(trimmedText);
  }

  if (trimmedText.startsWith("{")) {
    return parseNdjsonFrames(streamText);
  }

  return createFinalOutputUnavailable("unsupported_framing");
}

export function finalizeStreamOutput(
  value: unknown,
  metadata: StreamFinalOutputDiagnosticMetadata = {}
): StreamFinalOutput {
  let serializedValue: string;

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return createFinalOutputUnavailable("stream_error", metadata);
    }
    serializedValue = serialized;
  } catch (error) {
    if (error instanceof TypeError) {
      return createFinalOutputUnavailable("stream_error", metadata);
    }
    throw error;
  }

  if (serializedValue.length > LANGFUSE_FINAL_OUTPUT_MAX_SERIALIZED_CHARS) {
    return createFinalOutputUnavailable("over_budget", {
      ...metadata,
      serializedBytes: serializedValue.length,
      maxSerializedBytes: LANGFUSE_FINAL_OUTPUT_MAX_SERIALIZED_CHARS,
    });
  }

  return { kind: "final", value };
}

function parseSSEFrames(streamText: string): ParseStreamFramesResult {
  const events = parseSSEData(streamText);
  if (
    events.length === 0 ||
    events.some((event) => typeof event.data === "string" && event.data !== "[DONE]")
  ) {
    return createFinalOutputUnavailable("malformed_frame", {
      eventCount: events.length,
      framing: "sse",
    });
  }

  return {
    kind: "frames",
    framing: "sse",
    frames: events.map((event) => ({
      framing: "sse",
      event: event.event,
      data: event.data,
    })),
  };
}

function parseNdjsonFrames(streamText: string): ParseStreamFramesResult {
  const lines = streamText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const frames: StreamFrame[] = [];

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return createFinalOutputUnavailable("malformed_frame", {
          eventCount: frames.length,
          framing: "ndjson",
        });
      }
      throw error;
    }

    if (!isJsonObject(parsed)) {
      return createFinalOutputUnavailable("malformed_frame", {
        eventCount: frames.length,
        framing: "ndjson",
      });
    }

    frames.push({ framing: "ndjson", event: null, data: parsed });
  }

  if (frames.length === 0) {
    return createFinalOutputUnavailable("empty_stream");
  }

  return { kind: "frames", framing: "ndjson", frames };
}

function parseJsonArrayFrames(streamText: string): ParseStreamFramesResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(streamText);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return createFinalOutputUnavailable("malformed_frame", {
        framing: "json-array",
      });
    }
    throw error;
  }

  if (!Array.isArray(parsed)) {
    return createFinalOutputUnavailable("malformed_frame", {
      framing: "json-array",
    });
  }

  const frames: StreamFrame[] = [];
  for (const record of parsed) {
    if (!isJsonObject(record)) {
      return createFinalOutputUnavailable("malformed_frame", {
        eventCount: frames.length,
        framing: "json-array",
      });
    }
    frames.push({ framing: "json-array", event: null, data: record });
  }

  if (frames.length === 0) {
    return createFinalOutputUnavailable("empty_stream");
  }

  return { kind: "frames", framing: "json-array", frames };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
