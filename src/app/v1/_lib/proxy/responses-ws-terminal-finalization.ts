import type { ResponsesWsServerEvent } from "./responses-ws-schema";
import { isResponsesWsTerminalEvent } from "./responses-ws-schema";

export interface ResponsesWsTerminalCollectorOptions {
  maxHeadEvents?: number;
  maxTailEvents?: number;
}

export interface ResponsesWsTerminalSnapshot {
  eventCount: number;
  headEvents: ResponsesWsServerEvent[];
  tailEvents: ResponsesWsServerEvent[];
  terminalEvent: ResponsesWsServerEvent | null;
}

export interface NormalizedResponsesWsTerminalEvent {
  terminalState: "completed" | "failed" | "incomplete";
  payload: Record<string, unknown>;
}

export function normalizeResponsesWsTerminalEvent(
  event: ResponsesWsServerEvent | null
): NormalizedResponsesWsTerminalEvent | null {
  if (!event || !isResponsesWsTerminalEvent(event)) {
    return null;
  }

  const TERMINAL_STATE_MAP: Record<string, "completed" | "failed" | "incomplete"> = {
    "response.completed": "completed",
    "response.failed": "failed",
    "response.incomplete": "incomplete",
    error: "failed",
  };

  const terminalState = TERMINAL_STATE_MAP[event.type];
  if (!terminalState) {
    return null;
  }

  const payload = { ...event } as Record<string, unknown>;
  delete payload.type;

  return {
    terminalState,
    payload,
  };
}

export function createResponsesWsTerminalCollector(
  options: ResponsesWsTerminalCollectorOptions = {}
) {
  const maxHeadEvents = options.maxHeadEvents ?? 16;
  const maxTailEvents = options.maxTailEvents ?? 16;
  const headEvents: ResponsesWsServerEvent[] = [];
  const tailEvents: ResponsesWsServerEvent[] = [];
  let eventCount = 0;
  let terminalEvent: ResponsesWsServerEvent | null = null;

  return {
    push(event: ResponsesWsServerEvent) {
      eventCount += 1;
      if (headEvents.length < maxHeadEvents) {
        headEvents.push(event);
      } else if (maxTailEvents > 0) {
        tailEvents.push(event);
        if (tailEvents.length > maxTailEvents) {
          tailEvents.shift();
        }
      }

      if (!terminalEvent && isResponsesWsTerminalEvent(event)) {
        terminalEvent = event;
      }
    },
    getSnapshot(): ResponsesWsTerminalSnapshot {
      return {
        eventCount,
        headEvents: [...headEvents],
        tailEvents: [...tailEvents],
        terminalEvent,
      };
    },
    getTerminalEvent() {
      return terminalEvent;
    },
    getNormalizedTerminalEvent() {
      return normalizeResponsesWsTerminalEvent(terminalEvent);
    },
  };
}
