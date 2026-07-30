import { classifyFrame, type ProtocolFamily } from "./frame-classifier";
import { type SseFrame, SseFrameParser } from "./sse-frames";

export interface StreamProtocolFailure {
  verdict: "error" | "malformed";
  eventName: string | null;
}

export interface StreamProtocolObservation {
  sawContent: boolean;
  sawTerminal: boolean;
  failure: StreamProtocolFailure | null;
}

export interface StreamProtocolObserver {
  observe(chunk: Uint8Array): void;
  finish(): StreamProtocolObservation;
}

export function createStreamProtocolObserver(family: ProtocolFamily): StreamProtocolObserver {
  const parser = new SseFrameParser();
  const observation: StreamProtocolObservation = {
    sawContent: false,
    sawTerminal: false,
    failure: null,
  };
  let finished = false;
  let disabled = false;

  const record = (frame: SseFrame): void => {
    const verdict = classifyFrame(family, frame.eventName, frame.data);
    if (verdict === "content") observation.sawContent = true;
    if (verdict === "terminal") observation.sawTerminal = true;
    if ((verdict === "error" || verdict === "malformed") && !observation.failure) {
      observation.failure = { verdict, eventName: frame.eventName };
    }
  };

  return {
    observe(chunk: Uint8Array): void {
      if (finished || disabled || chunk.byteLength === 0) return;
      try {
        for (const frame of parser.push(chunk)) record(frame);
      } catch {
        // 旁路观察器异常不得改变客户端流或计费热路径。
        disabled = true;
      }
    },

    finish(): StreamProtocolObservation {
      if (!finished) {
        finished = true;
        if (!disabled) {
          try {
            for (const frame of parser.finish()) record(frame);
          } catch {
            disabled = true;
          }
        }
      }
      return {
        sawContent: observation.sawContent,
        sawTerminal: observation.sawTerminal,
        failure: observation.failure ? { ...observation.failure } : null,
      };
    },
  };
}
