/**
 * Anthropic 思考签名(`signature_delta`)模型名解析
 *
 * Anthropic 在流式响应里把"真正用于思考的模型名"嵌在 thinking signature 的
 * protobuf payload 中(字段路径 [2, 1, 6])。比 `message_start` 事件里的明文
 * `model` 字段更准确——明文 model 可能被上游中转层改写后不再与实际执行模型对齐。
 *
 * 本模块只做"按字段路径解析 protobuf";不解密、不依赖第三方库、
 * 任何异常一律返回 null,绝不抛。
 *
 * 字段路径作为可配参数,便于未来 Anthropic 调整 schema 时只改一行。
 */

import { extractJsonChunks } from "./actual-response-model";

const DEFAULT_FIELD_PATH: readonly number[] = [2, 1, 6];

/**
 * 从单个 base64 签名解出 protobuf 路径终点的 utf-8 字符串。
 *
 * - 输入 null/empty/非字符串 → null
 * - base64 / protobuf 任意异常 → null
 * - 终点必须是 wire-type 2(length-delimited)且解码为合法 utf-8 → 否则 null
 */
export function decodeThinkingSignatureModel(
  base64Signature: string | null | undefined,
  fieldPath: readonly number[] = DEFAULT_FIELD_PATH
): string | null {
  if (typeof base64Signature !== "string" || base64Signature.length === 0) return null;

  let buf: Buffer;
  try {
    buf = decodeBase64Strict(base64Signature);
  } catch {
    return null;
  }
  if (buf.length === 0) return null;

  try {
    const terminalBytes = walkLengthDelimitedPath(buf, fieldPath);
    if (!terminalBytes) return null;
    return safeUtf8(terminalBytes);
  } catch {
    return null;
  }
}

/**
 * 扫描 SSE 流文本,寻找首个能成功解出模型名的 `signature_delta` 事件。
 * 复用 actual-response-model 的 `extractJsonChunks`(同时兼容 SSE 与 NDJSON)。
 */
export function extractThinkingSignatureModelFromStream(
  sseText: string | null | undefined,
  fieldPath: readonly number[] = DEFAULT_FIELD_PATH
): string | null {
  if (typeof sseText !== "string" || sseText.length === 0) return null;

  for (const chunk of extractJsonChunks(sseText)) {
    let obj: unknown;
    try {
      obj = JSON.parse(chunk);
    } catch {
      continue;
    }
    const signature = readSignatureFromContentBlockDelta(obj);
    if (!signature) continue;
    const model = decodeThinkingSignatureModel(signature, fieldPath);
    if (model) return model;
  }
  return null;
}

function readSignatureFromContentBlockDelta(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const typed = obj as { type?: unknown; delta?: unknown };
  if (typed.type !== "content_block_delta") return null;
  if (!typed.delta || typeof typed.delta !== "object") return null;
  const delta = typed.delta as { type?: unknown; signature?: unknown };
  if (delta.type !== "signature_delta") return null;
  if (typeof delta.signature !== "string" || delta.signature.length === 0) return null;
  return delta.signature;
}

/**
 * Node `Buffer.from(text, "base64")` 对非法字符是"宽容"的(会忽略),
 * 这里加一个轻量校验:只允许 base64 alphabet + 可选 padding。
 * 解出零字节时也视为非法,避免把 "!!!" 误判成空 payload。
 */
function decodeBase64Strict(input: string): Buffer {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error("empty");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new Error("invalid base64 alphabet");
  }
  // base64 长度必须是 4 的倍数(去 padding 后允许 2/3 位余数,标准 base64 一般要 padding)
  if (trimmed.length % 4 !== 0) throw new Error("invalid base64 length");
  return Buffer.from(trimmed, "base64");
}

function safeUtf8(bytes: Buffer): string | null {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 按字段路径走 protobuf,每层都必须是 wire-type 2 (length-delimited)。
 * - 路径长度 ≥ 1
 * - 终点字段也必须是 wire-type 2 (string/bytes/nested message)
 * - 路径上任意一层缺失/类型不符 → 返回 null
 */
function walkLengthDelimitedPath(buf: Buffer, path: readonly number[]): Buffer | null {
  if (path.length === 0) return null;
  let current: Buffer = buf;
  for (const fieldNumber of path) {
    const field = findFirstField(current, fieldNumber);
    if (!field) return null;
    if (field.wireType !== 2 || !field.bytes) return null;
    current = field.bytes;
  }
  return current;
}

interface ProtoField {
  fieldNumber: number;
  wireType: number;
  /** length-delimited 的 payload 切片(wire-type ≠ 2 时为 undefined) */
  bytes?: Buffer;
  /** 整个 field(包括 tag/length 头)在父 buffer 的结束偏移(用于继续遍历兄弟字段) */
  endOffset: number;
}

function findFirstField(buf: Buffer, fieldNumber: number): ProtoField | null {
  let offset = 0;
  while (offset < buf.length) {
    const field = readNextField(buf, offset);
    if (!field) return null;
    if (field.fieldNumber === fieldNumber) return field;
    offset = field.endOffset;
  }
  return null;
}

const VARINT_TAG_FIELD_SHIFT = BigInt(3);
const VARINT_TAG_WIRE_MASK = BigInt(0x07);
const VARINT_BYTE_DATA_MASK = 0x7f;
const VARINT_CONTINUATION_MASK = 0x80;
const VARINT_PAYLOAD_BITS_PER_BYTE = BigInt(7);
const VARINT_MAX_SHIFT_BITS = BigInt(63);

function readNextField(buf: Buffer, startOffset: number): ProtoField | null {
  const tag = readVarint(buf, startOffset);
  if (!tag) return null;
  const key = tag.value;
  const fieldNumber = Number(key >> VARINT_TAG_FIELD_SHIFT);
  const wireType = Number(key & VARINT_TAG_WIRE_MASK);
  if (fieldNumber <= 0) return null;
  let offset = tag.nextOffset;

  switch (wireType) {
    case 0: {
      const v = readVarint(buf, offset);
      if (!v) return null;
      return { fieldNumber, wireType, endOffset: v.nextOffset };
    }
    case 1: {
      if (offset + 8 > buf.length) return null;
      return { fieldNumber, wireType, endOffset: offset + 8 };
    }
    case 2: {
      const len = readVarint(buf, offset);
      if (!len) return null;
      const length = Number(len.value);
      if (!Number.isSafeInteger(length) || length < 0) return null;
      offset = len.nextOffset;
      if (offset + length > buf.length) return null;
      return {
        fieldNumber,
        wireType,
        bytes: buf.subarray(offset, offset + length),
        endOffset: offset + length,
      };
    }
    case 5: {
      if (offset + 4 > buf.length) return null;
      return { fieldNumber, wireType, endOffset: offset + 4 };
    }
    default:
      return null;
  }
}

function readVarint(
  buf: Buffer,
  startOffset: number
): { value: bigint; nextOffset: number } | null {
  let result = BigInt(0);
  let shift = BigInt(0);
  let pos = startOffset;
  while (pos < buf.length) {
    const byte = buf[pos];
    pos += 1;
    result |= BigInt(byte & VARINT_BYTE_DATA_MASK) << shift;
    if ((byte & VARINT_CONTINUATION_MASK) === 0) {
      return { value: result, nextOffset: pos };
    }
    shift += VARINT_PAYLOAD_BITS_PER_BYTE;
    if (shift > VARINT_MAX_SHIFT_BITS) return null; // varint too long
  }
  return null; // eof
}
