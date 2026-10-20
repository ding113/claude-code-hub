import { finalizeAnthropicStreamOutput } from "@/lib/langfuse/stream-final-output-anthropic";
import {
  createFinalOutputUnavailable,
  type ParsedStreamFrames,
  parseStreamFrames,
  type StreamFinalOutput,
} from "@/lib/langfuse/stream-final-output-core";
import { finalizeGeminiStreamOutput } from "@/lib/langfuse/stream-final-output-gemini";
import {
  finalizeOpenAIChatStream,
  finalizeOpenAIResponsesStream,
} from "@/lib/langfuse/stream-final-output-openai";

export type StreamClientFormat = "claude" | "openai" | "response" | "gemini" | "gemini-cli";

type StreamFinalizer = (frames: ParsedStreamFrames) => StreamFinalOutput;

const STREAM_FINALIZERS: Readonly<Record<StreamClientFormat, StreamFinalizer>> = {
  claude: finalizeAnthropicStreamOutput,
  openai: finalizeOpenAIChatStream,
  response: finalizeOpenAIResponsesStream,
  gemini: finalizeGeminiStreamOutput,
  "gemini-cli": finalizeGeminiStreamOutput,
};

export function finalizeStreamOutputForClient(
  streamText: string,
  clientFormat: StreamClientFormat,
  isStreaming: boolean
): StreamFinalOutput | undefined {
  if (!isStreaming) {
    return undefined;
  }

  try {
    const parsed = parseStreamFrames(streamText);
    if (parsed.kind !== "frames") {
      return parsed;
    }

    const finalizer = STREAM_FINALIZERS[clientFormat];
    if (finalizer === undefined) {
      return createFinalOutputUnavailable("unsupported_framing", {
        eventCount: parsed.frames.length,
        framing: parsed.framing,
      });
    }

    return finalizer(parsed);
  } catch (error) {
    if (error instanceof Error) {
      return createFinalOutputUnavailable("stream_error");
    }
    return createFinalOutputUnavailable("stream_error");
  }
}
