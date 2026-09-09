import {
  createFinalOutputUnavailable,
  finalizeStreamOutput,
  type ParsedStreamFrames,
  type StreamFinalOutput,
  type StreamFrame,
} from "@/lib/langfuse/stream-final-output-core";

type JsonObject = Record<string, unknown>;

type ContentBlockState = {
  readonly block: JsonObject;
  readonly inputJsonFragments: string[];
  readonly isToolUse: boolean;
  stopped: boolean;
};

export function finalizeAnthropicStreamOutput(parsedFrames: ParsedStreamFrames): StreamFinalOutput {
  const metadata = {
    eventCount: parsedFrames.frames.length,
    framing: parsedFrames.framing,
  } as const;
  const blocks = new Map<number, ContentBlockState>();
  let messageSkeleton: JsonObject | undefined;
  let messageStopped = false;

  for (const frame of parsedFrames.frames) {
    const eventName = getEventName(frame);
    if (eventName === null) {
      continue;
    }

    switch (eventName) {
      case "message_start": {
        const data = getEventData(frame);
        const message = data === null ? null : data.message;
        if (messageSkeleton !== undefined || !isJsonObject(message)) {
          return createFinalOutputUnavailable("malformed_frame", metadata);
        }
        if (hasOwn(message, "content") && !Array.isArray(message.content)) {
          return createFinalOutputUnavailable("malformed_frame", metadata);
        }
        messageSkeleton = { ...message };
        break;
      }
      case "content_block_start": {
        const data = getEventData(frame);
        const index = getIndex(data);
        const contentBlock = data === null ? null : data.content_block;
        if (index === null || !isJsonObject(contentBlock) || blocks.has(index)) {
          return createFinalOutputUnavailable("malformed_frame", metadata);
        }
        if (messageSkeleton === undefined) {
          return createFinalOutputUnavailable("malformed_frame", metadata);
        }
        blocks.set(index, {
          block: { ...contentBlock },
          inputJsonFragments: [],
          isToolUse: contentBlock.type === "tool_use",
          stopped: false,
        });
        break;
      }
      case "content_block_delta": {
        const data = getEventData(frame);
        const index = getIndex(data);
        const delta = data === null ? null : data.delta;
        const blockState = index === null ? undefined : blocks.get(index);
        if (
          index === null ||
          !isJsonObject(delta) ||
          blockState === undefined ||
          blockState.stopped
        ) {
          return createFinalOutputUnavailable("malformed_frame", metadata);
        }

        const deltaType = delta.type;
        if (deltaType === "text_delta") {
          const text = delta.text;
          if (blockState.block.type !== "text" || typeof text !== "string") {
            return createFinalOutputUnavailable("malformed_frame", metadata);
          }
          blockState.block.text = appendText(blockState.block.text, text);
        } else if (deltaType === "thinking_delta") {
          const thinking = delta.thinking;
          if (blockState.block.type !== "thinking" || typeof thinking !== "string") {
            return createFinalOutputUnavailable("malformed_frame", metadata);
          }
          blockState.block.thinking = appendText(blockState.block.thinking, thinking);
        } else if (deltaType === "signature_delta") {
          const signature = delta.signature;
          if (blockState.block.type !== "thinking" || typeof signature !== "string") {
            return createFinalOutputUnavailable("malformed_frame", metadata);
          }
          blockState.block.signature = appendText(blockState.block.signature, signature);
        } else if (deltaType === "input_json_delta") {
          const partialJson = delta.partial_json;
          if (!blockState.isToolUse || typeof partialJson !== "string") {
            return createFinalOutputUnavailable("malformed_frame", metadata);
          }
          blockState.inputJsonFragments.push(partialJson);
        } else {
          return createFinalOutputUnavailable("malformed_frame", metadata);
        }
        break;
      }
      case "content_block_stop": {
        const data = getEventData(frame);
        const index = getIndex(data);
        const blockState = index === null ? undefined : blocks.get(index);
        if (index === null || blockState === undefined || blockState.stopped) {
          return createFinalOutputUnavailable("malformed_frame", metadata);
        }
        if (blockState.isToolUse) {
          const inputJson = blockState.inputJsonFragments.join("");
          try {
            const parsedInput: unknown = JSON.parse(inputJson);
            blockState.block.input = parsedInput;
          } catch (error) {
            if (error instanceof SyntaxError) {
              return createFinalOutputUnavailable("malformed_frame", metadata);
            }
            throw error;
          }
        }
        blockState.stopped = true;
        break;
      }
      case "message_delta": {
        const data = getEventData(frame);
        const delta = data === null ? null : data.delta;
        if (data === null || messageSkeleton === undefined || !isJsonObject(delta)) {
          return createFinalOutputUnavailable("malformed_frame", metadata);
        }
        if (hasOwn(delta, "stop_reason")) {
          const stopReason = delta.stop_reason;
          if (stopReason !== null && typeof stopReason !== "string") {
            return createFinalOutputUnavailable("malformed_frame", metadata);
          }
          messageSkeleton.stop_reason = stopReason;
        }
        if (hasOwn(delta, "stop_sequence")) {
          const stopSequence = delta.stop_sequence;
          if (stopSequence !== null && typeof stopSequence !== "string") {
            return createFinalOutputUnavailable("malformed_frame", metadata);
          }
          messageSkeleton.stop_sequence = stopSequence;
        }
        if (hasOwn(data, "usage")) {
          const usage = data.usage;
          if (!isJsonObject(usage)) {
            return createFinalOutputUnavailable("malformed_frame", metadata);
          }
          const previousUsage = messageSkeleton.usage;
          messageSkeleton.usage = isJsonObject(previousUsage)
            ? { ...previousUsage, ...usage }
            : usage;
        }
        break;
      }
      case "message_stop": {
        if (getEventData(frame) === null) {
          return createFinalOutputUnavailable("malformed_frame", metadata);
        }
        messageStopped = true;
        break;
      }
      default:
        break;
    }
  }

  if (messageSkeleton === undefined) {
    return createFinalOutputUnavailable("malformed_frame", metadata);
  }
  if (!messageStopped) {
    return createFinalOutputUnavailable("no_terminal_event", metadata);
  }
  if ([...blocks.values()].some((blockState) => !blockState.stopped)) {
    return createFinalOutputUnavailable("malformed_frame", metadata);
  }

  const content = [...blocks.entries()]
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, blockState]) => blockState.block);
  const message =
    blocks.size > 0 || hasOwn(messageSkeleton, "content")
      ? { ...messageSkeleton, content }
      : { ...messageSkeleton };

  return finalizeStreamOutput(message, metadata);
}

function getEventName(frame: StreamFrame): string | null {
  if (frame.event !== null) {
    return frame.event;
  }
  if (!isJsonObject(frame.data) || typeof frame.data.type !== "string") {
    return null;
  }
  return frame.data.type;
}

function getEventData(frame: StreamFrame): JsonObject | null {
  if (!isJsonObject(frame.data)) {
    return null;
  }
  return frame.data;
}

function getIndex(data: JsonObject | null): number | null {
  const index = data?.index;
  return typeof index === "number" && Number.isInteger(index) && index >= 0 ? index : null;
}

function appendText(previous: unknown, next: string): string {
  return typeof previous === "string" ? previous + next : next;
}

function hasOwn(object: JsonObject, key: string): boolean {
  return Object.hasOwn(object, key);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
