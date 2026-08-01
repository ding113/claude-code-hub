import { classifyFrame, isRequestEchoFrame, type ProtocolFamily } from "./frame-classifier";
import { type SseFrame, SseFrameParser } from "./sse-frames";
import { resolveStreamGateCaps } from "./stream-content-gate";

export const STREAM_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS = 10 * 1024 * 1024;
const DEFAULT_STREAM_GATE_PREBUFFER_CHARACTERS = 10 * 1024 * 1024;

export interface StreamProtocolFailure {
  afterContent: boolean;
  verdict: "error" | "malformed";
  eventName: string | null;
}

export interface StreamProtocolObservation {
  sawContent: boolean;
  sawTerminal: boolean;
  observationIncomplete: boolean;
  failure: StreamProtocolFailure | null;
}

export interface StreamProtocolObserver {
  observe(chunk: Uint8Array): StreamProtocolFailure | null;
  finish(): StreamProtocolObservation;
}

export function createStreamProtocolObserver(family: ProtocolFamily): StreamProtocolObserver {
  const { prebufferByteCap } = resolveStreamGateCaps();
  const streamGatePrebufferCharacters =
    Number.isSafeInteger(prebufferByteCap) && prebufferByteCap > 0
      ? prebufferByteCap
      : DEFAULT_STREAM_GATE_PREBUFFER_CHARACTERS;
  const parser = new SseFrameParser({
    bufferLimitExemption: {
      // 门禁对 request echo 的豁免额度最多把总缓冲抬到 2x cap；observer 采用同一边界，
      // 允许合法的大请求回显，同时继续阻止伪装 echo 的无界单帧。
      maxBufferedCharacters: streamGatePrebufferCharacters * 2,
      matches: (eventName, dataHead) => isRequestEchoFrame(family, eventName, dataHead),
    },
    maxBufferedCharacters: STREAM_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS,
  });
  const observation: StreamProtocolObservation = {
    sawContent: false,
    sawTerminal: false,
    observationIncomplete: false,
    failure: null,
  };
  let finished = false;
  let disabled = false;

  const disableIncompleteObservation = (): void => {
    disabled = true;
    observation.observationIncomplete = true;
  };

  const record = (frame: SseFrame): void => {
    const verdict = classifyFrame(family, frame.eventName, frame.data);
    if (verdict === "content") observation.sawContent = true;
    if (verdict === "terminal") observation.sawTerminal = true;
    if ((verdict === "error" || verdict === "malformed") && !observation.failure) {
      observation.failure = {
        afterContent: observation.sawContent,
        verdict,
        eventName: frame.eventName,
      };
    }
  };

  return {
    observe(chunk: Uint8Array): StreamProtocolFailure | null {
      if (finished || disabled || chunk.byteLength === 0) return observation.failure;
      try {
        for (const frame of parser.push(chunk)) record(frame);
      } catch {
        // parser 容量保护和本地观察异常只能说明观察不完整，不能伪造上游 malformed。
        // 旁路 observer 必须 fail-open，避免本地资源或实现问题改写客户端流与计费终态。
        disableIncompleteObservation();
      }
      return observation.failure;
    },

    finish(): StreamProtocolObservation {
      if (!finished) {
        finished = true;
        if (!disabled) {
          try {
            for (const frame of parser.finish()) record(frame);
          } catch {
            disableIncompleteObservation();
          }
        }
      }
      return {
        sawContent: observation.sawContent,
        sawTerminal: observation.sawTerminal,
        observationIncomplete: observation.observationIncomplete,
        failure: observation.failure ? { ...observation.failure } : null,
      };
    },
  };
}
