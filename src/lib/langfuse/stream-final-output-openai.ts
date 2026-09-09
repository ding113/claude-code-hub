import {
  createFinalOutputUnavailable,
  finalizeStreamOutput,
  type ParsedStreamFrames,
  type StreamFinalOutput,
} from "@/lib/langfuse/stream-final-output-core";

type JsonRecord = Record<string, unknown>;

type FunctionAccumulator = {
  name?: string;
  arguments: string;
};

type ToolCallAccumulator = {
  readonly index: number;
  id?: string;
  type?: string;
  function: FunctionAccumulator;
};

type ChoiceAccumulator = {
  readonly index: number;
  readonly message: JsonRecord;
  readonly toolCalls: Map<number, ToolCallAccumulator>;
  functionCall?: FunctionAccumulator;
  finishReason?: string;
  logprobs?: unknown;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendString(target: JsonRecord, key: string, value: unknown): void {
  if (typeof value !== "string") return;
  const previous = target[key];
  target[key] = typeof previous === "string" ? previous + value : value;
}

function retainFirstString(target: JsonRecord, key: string, value: unknown): void {
  if (typeof value !== "string" || typeof target[key] === "string") return;
  target[key] = value;
}

function appendFunctionDelta(target: FunctionAccumulator, delta: unknown): void {
  if (!isRecord(delta)) return;
  retainFirstString(target, "name", delta.name);
  appendString(target, "arguments", delta.arguments);
}

function createFunctionAccumulator(): FunctionAccumulator {
  return { arguments: "" };
}

function readChoiceAccumulator(
  choices: Map<number, ChoiceAccumulator>,
  index: number
): ChoiceAccumulator {
  const existing = choices.get(index);
  if (existing) return existing;

  const created: ChoiceAccumulator = {
    index,
    message: {},
    toolCalls: new Map(),
  };
  choices.set(index, created);
  return created;
}

function foldToolCalls(choice: ChoiceAccumulator, value: unknown): void {
  if (!Array.isArray(value)) return;

  value.forEach((rawToolCall, position) => {
    if (!isRecord(rawToolCall)) return;
    const index = typeof rawToolCall.index === "number" ? rawToolCall.index : position;
    const existing = choice.toolCalls.get(index);
    const toolCall = existing ?? {
      index,
      function: createFunctionAccumulator(),
    };

    if (typeof rawToolCall.id === "string" && toolCall.id === undefined) {
      toolCall.id = rawToolCall.id;
    }
    if (typeof rawToolCall.type === "string" && toolCall.type === undefined) {
      toolCall.type = rawToolCall.type;
    }
    appendFunctionDelta(toolCall.function, rawToolCall.function);
    choice.toolCalls.set(index, toolCall);
  });
}

function foldChoice(choice: ChoiceAccumulator, rawChoice: unknown): void {
  if (!isRecord(rawChoice)) return;
  const delta = isRecord(rawChoice.delta) ? rawChoice.delta : {};

  retainFirstString(choice.message, "role", delta.role);
  retainFirstString(choice.message, "id", delta.id);
  retainFirstString(choice.message, "name", delta.name);
  appendString(choice.message, "content", delta.content);
  appendString(choice.message, "reasoning_content", delta.reasoning_content);

  if (isRecord(delta.function_call)) {
    choice.functionCall ??= createFunctionAccumulator();
    appendFunctionDelta(choice.functionCall, delta.function_call);
  }
  foldToolCalls(choice, delta.tool_calls);

  if (typeof rawChoice.finish_reason === "string") {
    choice.finishReason = rawChoice.finish_reason;
  }
  if (rawChoice.logprobs !== null && rawChoice.logprobs !== undefined) {
    choice.logprobs = rawChoice.logprobs;
  }
}

function buildFunctionValue(value: FunctionAccumulator): JsonRecord {
  return {
    ...(value.name !== undefined ? { name: value.name } : {}),
    ...(value.arguments.length > 0 ? { arguments: value.arguments } : {}),
  };
}

function buildToolCallValue(value: ToolCallAccumulator): JsonRecord {
  return {
    index: value.index,
    ...(value.id !== undefined ? { id: value.id } : {}),
    ...(value.type !== undefined ? { type: value.type } : {}),
    function: buildFunctionValue(value.function),
  };
}

function buildChoiceValue(value: ChoiceAccumulator): JsonRecord {
  const toolCalls = [...value.toolCalls.values()]
    .sort((left, right) => left.index - right.index)
    .map(buildToolCallValue);
  const message = {
    ...value.message,
    ...(value.functionCall ? { function_call: buildFunctionValue(value.functionCall) } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };

  return {
    index: value.index,
    message,
    finish_reason: value.finishReason ?? null,
    logprobs: value.logprobs ?? null,
  };
}

export function finalizeOpenAIChatStream(frames: ParsedStreamFrames): StreamFinalOutput {
  const choices = new Map<number, ChoiceAccumulator>();
  let id: string | undefined;
  let created: number | undefined;
  let model: string | undefined;
  let systemFingerprint: string | undefined;
  let usage: JsonRecord | undefined;

  for (const frame of frames.frames) {
    if (typeof frame.data === "string") continue;
    if (!isRecord(frame.data)) continue;

    if (typeof frame.data.id === "string") id = frame.data.id;
    if (typeof frame.data.created === "number") created = frame.data.created;
    if (typeof frame.data.model === "string") model = frame.data.model;
    if (typeof frame.data.system_fingerprint === "string") {
      systemFingerprint = frame.data.system_fingerprint;
    }
    if (isRecord(frame.data.usage)) usage = frame.data.usage;

    if (!Array.isArray(frame.data.choices)) continue;
    frame.data.choices.forEach((rawChoice, position) => {
      const index =
        isRecord(rawChoice) && typeof rawChoice.index === "number" ? rawChoice.index : position;
      foldChoice(readChoiceAccumulator(choices, index), rawChoice);
    });
  }

  if (
    choices.size === 0 ||
    [...choices.values()].some((choice) => choice.finishReason === undefined)
  ) {
    return createFinalOutputUnavailable("no_terminal_event", {
      eventCount: frames.frames.length,
      framing: frames.framing,
    });
  }

  const value = {
    id: id ?? "",
    object: "chat.completion",
    created: created ?? 0,
    model: model ?? "",
    ...(systemFingerprint !== undefined ? { system_fingerprint: systemFingerprint } : {}),
    choices: [...choices.values()]
      .sort((left, right) => left.index - right.index)
      .map(buildChoiceValue),
    ...(usage !== undefined ? { usage } : {}),
  };

  return finalizeStreamOutput(value, {
    eventCount: frames.frames.length,
    framing: frames.framing,
  });
}

function eventType(frame: ParsedStreamFrames["frames"][number]): string | null {
  if (isRecord(frame.data) && typeof frame.data.type === "string") return frame.data.type;
  return frame.event;
}

function responseDiagnostic(
  frames: ParsedStreamFrames,
  reason: "stream_error" | "no_terminal_event"
) {
  return createFinalOutputUnavailable(reason, {
    eventCount: frames.frames.length,
    framing: frames.framing,
  });
}

export function finalizeOpenAIResponsesStream(frames: ParsedStreamFrames): StreamFinalOutput {
  for (const frame of frames.frames) {
    if (typeof frame.data === "string" || !isRecord(frame.data)) continue;
    const type = eventType(frame);

    if (type === "response.failed" || type === "response.error" || type === "error") {
      return responseDiagnostic(frames, "stream_error");
    }
    if (type === "response.completed") {
      if (isRecord(frame.data.response)) {
        return finalizeStreamOutput(frame.data.response, {
          eventCount: frames.frames.length,
          framing: frames.framing,
        });
      }
      return responseDiagnostic(frames, "stream_error");
    }
    if (type === "response.incomplete") {
      if (!isRecord(frame.data.response)) return responseDiagnostic(frames, "stream_error");
      const incompleteDetails = frame.data.incomplete_details;
      const value =
        incompleteDetails !== undefined && incompleteDetails !== null
          ? { ...frame.data.response, incomplete_details: incompleteDetails }
          : frame.data.response;
      return finalizeStreamOutput(value, {
        eventCount: frames.frames.length,
        framing: frames.framing,
      });
    }
  }

  return responseDiagnostic(frames, "no_terminal_event");
}
