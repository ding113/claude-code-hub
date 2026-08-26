import {
  classifyFrame,
  classifyStructuredFrame,
  classifyStructuredTerminalKind,
  classifyTerminalKind,
  type FrameVerdict,
  isRequestEchoFrame,
  type ProtocolFamily,
} from "./frame-classifier";
import { SseFrameParser } from "./sse-frames";
import { resolveStreamGateCaps } from "./stream-content-gate";

export const STREAM_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS = 10 * 1024 * 1024;
const DEFAULT_STREAM_GATE_PREBUFFER_CHARACTERS = 10 * 1024 * 1024;

export interface StreamProtocolFailure {
  afterContent: boolean;
  verdict: "error" | "malformed";
  eventName: string | null;
  sawMalformed?: true;
}

export interface StreamProtocolObservation {
  sawContent: boolean;
  sawTerminal: boolean;
  sawIncomplete: boolean;
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
      maxBufferedCharacters: Math.max(
        streamGatePrebufferCharacters * 2,
        STREAM_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS
      ),
      matches: (eventName, dataHead) => isRequestEchoFrame(family, eventName, dataHead),
    },
    maxBufferedCharacters: STREAM_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS,
  });
  const observation: StreamProtocolObservation = {
    sawContent: false,
    sawTerminal: false,
    sawIncomplete: false,
    observationIncomplete: false,
    failure: null,
  };
  let finished = false;
  let disabled = false;

  const disableIncompleteObservation = (): void => {
    disabled = true;
    observation.observationIncomplete = true;
  };

  const record = (eventName: string | null, data: string): boolean | undefined => {
    const trimmed = data.trim();
    let parsed: object | null = null;
    let verdict: FrameVerdict;
    if (trimmed === "[DONE]") {
      verdict = classifyFrame(family, eventName, data);
    } else if (trimmed[0] === "{" || trimmed[0] === "[") {
      try {
        const value = JSON.parse(trimmed) as unknown;
        if (value !== null && typeof value === "object") {
          parsed = value;
          verdict = classifyStructuredFrame(family, eventName, value);
        } else {
          verdict = classifyFrame(family, eventName, data);
        }
      } catch {
        // 以 {/[ 开头但无法解析的载荷，和 classifyFrame 的结果一致；
        // 直接定为 malformed，避免对大型损坏帧重复 JSON.parse。
        verdict = "malformed";
      }
    } else {
      // [DONE]、空数据和非 JSON 数据沿用分类器的协议前置判定。
      verdict = classifyFrame(family, eventName, data);
    }
    if (verdict === "content") observation.sawContent = true;

    // Responses 的 response.completed 可能同时携带完整 compaction output，
    // 分类器会把它标成 content 以便门禁提交；终态观察不能因此丢失。
    let terminalKind = verdict === "terminal" ? classifyTerminalKind(family, eventName) : null;
    if (parsed) {
      terminalKind = classifyStructuredTerminalKind(family, eventName, parsed) ?? terminalKind;
    }
    if (terminalKind !== null) {
      if (terminalKind === "incomplete") {
        observation.sawIncomplete = true;
      } else {
        observation.sawTerminal = true;
      }
    }
    if (verdict !== "error" && verdict !== "malformed") return;

    if (!observation.failure) {
      observation.failure = {
        afterContent: observation.sawContent,
        verdict,
        eventName,
      };
      return;
    }

    if (verdict === "error" && observation.failure.verdict === "malformed") {
      observation.failure = {
        afterContent: observation.sawContent,
        verdict,
        eventName,
        sawMalformed: true,
      };
    } else if (verdict === "malformed" && observation.failure.verdict === "error") {
      observation.failure = { ...observation.failure, sawMalformed: true };
    }
  };

  return {
    observe(chunk: Uint8Array): StreamProtocolFailure | null {
      if (finished || disabled || chunk.byteLength === 0) return observation.failure;
      try {
        parser.visit(chunk, record);
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
            parser.finishVisit(record);
          } catch {
            disableIncompleteObservation();
          }
        }
      }
      return {
        sawContent: observation.sawContent,
        sawTerminal: observation.sawTerminal,
        sawIncomplete: observation.sawIncomplete,
        observationIncomplete: observation.observationIncomplete,
        failure: observation.failure ? { ...observation.failure } : null,
      };
    },
  };
}
