import {
  createFinalOutputUnavailable,
  finalizeStreamOutput,
  type ParsedStreamFrames,
  type StreamFinalOutput,
} from "@/lib/langfuse/stream-final-output-core";

type JsonRecord = Record<string, unknown>;

type CandidateState = {
  candidate: JsonRecord;
  explicitIndex: number | null;
  position: number;
};

export function finalizeGeminiStreamOutput(parsed: ParsedStreamFrames): StreamFinalOutput {
  const metadata = {
    eventCount: parsed.frames.length,
    framing: parsed.framing,
  };

  if (parsed.frames.length === 0) {
    return createFinalOutputUnavailable("empty_stream", metadata);
  }

  const firstRecord = asJsonRecord(parsed.frames[0]?.data);
  const isEnvelope = firstRecord !== null && isJsonRecord(firstRecord.response);
  const responseMetadata: JsonRecord = {};
  const envelopeMetadata: JsonRecord = {};
  const candidates: CandidateState[] = [];

  for (const frame of parsed.frames) {
    const frameRecord = asJsonRecord(frame.data);
    if (frameRecord === null) {
      continue;
    }

    if (isEnvelope) {
      mergeLatestNonNullFields(envelopeMetadata, frameRecord, ["response"]);
    }

    const response = isEnvelope ? asJsonRecord(frameRecord.response) : frameRecord;
    if (response === null) {
      continue;
    }

    mergeLatestNonNullFields(responseMetadata, response, ["candidates"]);

    const frameCandidates = response.candidates;
    if (!Array.isArray(frameCandidates)) {
      continue;
    }

    frameCandidates.forEach((candidateValue, position) => {
      const candidate = asJsonRecord(candidateValue);
      if (candidate === null) {
        return;
      }

      const explicitIndex = readCandidateIndex(candidate.index);
      const existing = findCandidateState(candidates, position, explicitIndex);
      if (existing === null) {
        candidates.push({
          candidate: cloneCandidate(candidate),
          explicitIndex,
          position,
        });
        return;
      }

      if (existing.explicitIndex === null && explicitIndex !== null) {
        existing.explicitIndex = explicitIndex;
        existing.candidate.index = explicitIndex;
      }
      mergeCandidate(existing.candidate, candidate);
    });
  }

  if (candidates.length === 0) {
    return createFinalOutputUnavailable("no_terminal_event", metadata);
  }

  const hasTerminalCandidate = candidates.some(
    ({ candidate }) => candidate.finishReason !== null && candidate.finishReason !== undefined
  );
  if (!hasTerminalCandidate) {
    return createFinalOutputUnavailable("no_terminal_event", metadata);
  }

  responseMetadata.candidates = candidates.map(({ candidate }) => candidate);
  const value = isEnvelope
    ? {
        ...envelopeMetadata,
        response: responseMetadata,
      }
    : responseMetadata;

  return finalizeStreamOutput(value, metadata);
}

function findCandidateState(
  candidates: readonly CandidateState[],
  position: number,
  explicitIndex: number | null
): CandidateState | null {
  if (explicitIndex !== null) {
    return (
      candidates.find((state) => state.explicitIndex === explicitIndex) ??
      candidates.find((state) => state.explicitIndex === null && state.position === position) ??
      null
    );
  }

  return (
    candidates.find((state) => state.explicitIndex === null && state.position === position) ??
    candidates.find((state) => state.explicitIndex === position) ??
    null
  );
}

function cloneCandidate(candidate: JsonRecord): JsonRecord {
  const cloned: JsonRecord = { ...candidate };
  const content = asJsonRecord(candidate.content);
  if (content !== null) {
    cloned.content = cloneContent(content);
  }
  return cloned;
}

function cloneContent(content: JsonRecord): JsonRecord {
  const cloned: JsonRecord = { ...content };
  const parts = content.parts;
  if (Array.isArray(parts)) {
    cloned.parts = parts.map(clonePart);
  }
  return cloned;
}

function clonePart(part: unknown): unknown {
  const record = asJsonRecord(part);
  return record === null ? part : { ...record };
}

function mergeCandidate(target: JsonRecord, incoming: JsonRecord): void {
  mergeLatestNonNullFields(target, incoming, ["content", "index"]);

  const incomingContent = asJsonRecord(incoming.content);
  if (incomingContent === null) {
    return;
  }

  const targetContent = asJsonRecord(target.content);
  if (targetContent === null) {
    target.content = cloneContent(incomingContent);
    return;
  }

  mergeLatestNonNullFields(targetContent, incomingContent, ["parts", "role"]);
  if (targetContent.role === undefined && incomingContent.role !== undefined) {
    targetContent.role = incomingContent.role;
  }

  const incomingParts = incomingContent.parts;
  if (!Array.isArray(incomingParts)) {
    return;
  }

  const targetParts = Array.isArray(targetContent.parts) ? [...targetContent.parts] : [];
  for (const part of incomingParts) {
    appendContentPart(targetParts, part);
  }
  targetContent.parts = targetParts;
}

function appendContentPart(parts: unknown[], part: unknown): void {
  const partRecord = asJsonRecord(part);
  if (partRecord === null || !isTextOnlyPart(partRecord)) {
    parts.push(clonePart(part));
    return;
  }

  const lastPart = parts[parts.length - 1];
  const lastPartRecord = asJsonRecord(lastPart);
  if (lastPartRecord !== null && isTextOnlyPart(lastPartRecord)) {
    parts[parts.length - 1] = {
      ...lastPartRecord,
      text: `${lastPartRecord.text}${partRecord.text}`,
    };
    return;
  }

  parts.push({ ...partRecord });
}

function isTextOnlyPart(part: JsonRecord): part is JsonRecord & { text: string } {
  return typeof part.text === "string" && Object.keys(part).every((key) => key === "text");
}

function mergeLatestNonNullFields(
  target: JsonRecord,
  incoming: JsonRecord,
  excludedKeys: readonly string[]
): void {
  for (const [key, value] of Object.entries(incoming)) {
    if (excludedKeys.includes(key) || value === null || value === undefined) {
      continue;
    }
    target[key] = value;
  }
}

function readCandidateIndex(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asJsonRecord(value: unknown): JsonRecord | null {
  return isJsonRecord(value) ? value : null;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
