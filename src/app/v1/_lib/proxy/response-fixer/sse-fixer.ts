import type { FixResult } from "./types";

function isAsciiWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function startsWithBytes(data: Uint8Array, prefix: number[]): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (data[i] !== prefix[i]) return false;
  }
  return true;
}

function toLowerAscii(byte: number): number {
  if (byte >= 0x41 && byte <= 0x5a) return byte + 0x20;
  return byte;
}

const LF_BYTE = 0x0a;
const CR_BYTE = 0x0d;
const DATA_COLON = [0x64, 0x61, 0x74, 0x61, 0x3a] as const; // data:
const LF_BYTES = new Uint8Array([LF_BYTE]);

function concatUint8Chunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function includesDataColon(data: Uint8Array): boolean {
  // 仅用于启用判断：在 byte 层做最小子串搜索，避免 decode/字符串分配
  if (data.length < DATA_COLON.length) return false;
  for (let i = 0; i <= data.length - DATA_COLON.length; i += 1) {
    if (
      data[i] === DATA_COLON[0] &&
      data[i + 1] === DATA_COLON[1] &&
      data[i + 2] === DATA_COLON[2] &&
      data[i + 3] === DATA_COLON[3] &&
      data[i + 4] === DATA_COLON[4]
    ) {
      return true;
    }
  }
  return false;
}

function looksLikeJsonLine(line: Uint8Array): boolean {
  let i = 0;
  while (i < line.length && isAsciiWhitespace(line[i])) i += 1;
  if (i >= line.length) return false;

  const first = line[i];
  if (first === 0x7b /* { */ || first === 0x5b /* [ */) {
    return true;
  }

  // [DONE]
  const done = [0x5b, 0x44, 0x4f, 0x4e, 0x45, 0x5d]; // [ D O N E ]
  if (line.length - i >= done.length) {
    for (let j = 0; j < done.length; j += 1) {
      if (line[i + j] !== done[j]) return false;
    }
    return true;
  }

  return false;
}

function fixDataLine(line: Uint8Array): { line: Uint8Array; applied: boolean } {
  const prefix = [0x64, 0x61, 0x74, 0x61, 0x3a]; // data:
  if (!startsWithBytes(line, prefix)) {
    return { line, applied: false };
  }

  const after = line.subarray(prefix.length);
  if (after.length > 0 && after[0] === 0x20 /* space */) {
    return { line, applied: false };
  }

  const out = new Uint8Array(prefix.length + 1 + after.length);
  out.set(prefix, 0);
  out[prefix.length] = 0x20;
  out.set(after, prefix.length + 1);
  return { line: out, applied: true };
}

function fixFieldLine(line: Uint8Array, prefix: number[]): { line: Uint8Array; applied: boolean } {
  if (!startsWithBytes(line, prefix)) {
    return { line, applied: false };
  }

  const after = line.subarray(prefix.length);
  if (after.length > 0 && after[0] === 0x20 /* space */) {
    return { line, applied: false };
  }

  const out = new Uint8Array(prefix.length + 1 + after.length);
  out.set(prefix, 0);
  out[prefix.length] = 0x20;
  out.set(after, prefix.length + 1);
  return { line: out, applied: true };
}

function tryFixMalformed(line: Uint8Array): { line: Uint8Array; applied: boolean } | null {
  // 模式 1: "data :xxx"（data 与冒号之间只有空白）
  const dataPrefix = [0x64, 0x61, 0x74, 0x61]; // data
  if (startsWithBytes(line, dataPrefix)) {
    const rest = line.subarray(dataPrefix.length);
    let colonPos = -1;
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === 0x3a /* : */) {
        colonPos = i;
        break;
      }
    }

    if (colonPos >= 0) {
      let ok = true;
      for (let i = 0; i < colonPos; i += 1) {
        if (!isAsciiWhitespace(rest[i])) {
          ok = false;
          break;
        }
      }

      if (ok) {
        const afterColon = rest.subarray(colonPos + 1);
        let j = 0;
        while (j < afterColon.length && afterColon[j] === 0x20 /* space */) j += 1;
        const trimmed = afterColon.subarray(j);
        const out = new Uint8Array(6 + trimmed.length);
        out.set([0x64, 0x61, 0x74, 0x61, 0x3a, 0x20], 0); // data:␠
        out.set(trimmed, 6);
        return { line: out, applied: true };
      }
    }
  }

  // 模式 2: Data:/DATA: 等大小写错误
  if (line.length >= 5) {
    const lower0 = toLowerAscii(line[0]);
    const lower1 = toLowerAscii(line[1]);
    const lower2 = toLowerAscii(line[2]);
    const lower3 = toLowerAscii(line[3]);
    const lower4 = toLowerAscii(line[4]);
    if (
      lower0 === 0x64 &&
      lower1 === 0x61 &&
      lower2 === 0x74 &&
      lower3 === 0x61 &&
      lower4 === 0x3a
    ) {
      const normalized = new Uint8Array(line.length);
      normalized.set([0x64, 0x61, 0x74, 0x61, 0x3a], 0); // data:
      normalized.set(line.subarray(5), 5);
      const fixed = fixDataLine(normalized);
      return fixed.applied ? fixed : { line: normalized, applied: true };
    }
  }

  return null;
}

export class SseFixer {
  canFix(data: Uint8Array): boolean {
    if (
      startsWithBytes(data, [0x64, 0x61, 0x74, 0x61, 0x3a]) || // data:
      startsWithBytes(data, [0x65, 0x76, 0x65, 0x6e, 0x74, 0x3a]) || // event:
      startsWithBytes(data, [0x69, 0x64, 0x3a]) || // id:
      startsWithBytes(data, [0x72, 0x65, 0x74, 0x72, 0x79, 0x3a]) || // retry:
      startsWithBytes(data, [0x3a]) // :
    ) {
      return true;
    }

    // data: 字段的常见畸形写法（Data:/DATA:/data :/data  : ...）
    if (data.length >= 4) {
      const b0 = toLowerAscii(data[0]);
      const b1 = toLowerAscii(data[1]);
      const b2 = toLowerAscii(data[2]);
      const b3 = toLowerAscii(data[3]);
      if (b0 === 0x64 && b1 === 0x61 && b2 === 0x74 && b3 === 0x61) {
        return true;
      }
    }

    if (looksLikeJsonLine(data)) return true;

    // 简单包含判断（仅用于启用判断）
    return includesDataColon(data);
  }

  fix(input: Uint8Array): FixResult<Uint8Array> {
    if (!this.canFix(input)) {
      return { data: input, applied: false };
    }

    let out: Uint8Array[] | null = null;
    let cursor = 0;
    let changed = false;
    let lastWasEmpty = false;

    let pos = 0;
    while (pos < input.length) {
      const start = pos;
      let scan = start;
      let lineEnd = input.length;
      let nextPos = input.length;
      let newlineNormalized = false;

      while (scan < input.length) {
        const b = input[scan];
        if (b === LF_BYTE) {
          lineEnd = scan;
          nextPos = scan + 1;
          break;
        }
        if (b === CR_BYTE) {
          lineEnd = scan;
          nextPos = scan + 1;
          if (nextPos < input.length && input[nextPos] === LF_BYTE) {
            nextPos += 1;
          }
          newlineNormalized = true;
          break;
        }
        scan += 1;
      }

      // 末尾无换行：历史行为会补一个 LF，这里显式标记为变更（避免 applied=false 但数据不同）
      if (nextPos === input.length && lineEnd === input.length) {
        newlineNormalized = true;
      }

      pos = nextPos;
      const line = input.subarray(start, lineEnd);

      if (line.length === 0) {
        if (lastWasEmpty) {
          changed = true;
          if (!out) {
            out = [];
            if (start > 0) out.push(input.subarray(0, start));
            cursor = start;
          } else if (cursor < start) {
            out.push(input.subarray(cursor, start));
            cursor = start;
          }
          // 连续空行：跳过当前行（不输出任何内容）
          cursor = pos;
        } else if (newlineNormalized) {
          changed = true;
          if (!out) {
            out = [];
            if (start > 0) out.push(input.subarray(0, start));
            cursor = start;
          } else if (cursor < start) {
            out.push(input.subarray(cursor, start));
            cursor = start;
          }
          out.push(LF_BYTES);
          cursor = pos;
        } else if (out) {
          // 已经发生过变更：把原始段落（包含 LF）原样拷贝进输出
          out.push(input.subarray(cursor, pos));
          cursor = pos;
        }
        lastWasEmpty = true;
        continue;
      }
      lastWasEmpty = false;

      const fixed = this.fixLine(line);
      const segmentChanged = fixed.applied || newlineNormalized;
      if (segmentChanged) changed = true;

      if (segmentChanged) {
        if (!out) {
          out = [];
          if (start > 0) out.push(input.subarray(0, start));
          cursor = start;
        } else if (cursor < start) {
          out.push(input.subarray(cursor, start));
          cursor = start;
        }
        out.push(fixed.applied ? fixed.line : line);
        out.push(LF_BYTES);
        cursor = pos;
      } else if (out) {
        out.push(input.subarray(cursor, pos));
        cursor = pos;
      }
    }

    if (!out) {
      return { data: input, applied: false };
    }

    if (cursor < input.length) {
      out.push(input.subarray(cursor));
    }

    return { data: concatUint8Chunks(out), applied: changed };
  }

  private fixLine(line: Uint8Array): { line: Uint8Array; applied: boolean } {
    if (startsWithBytes(line, [0x64, 0x61, 0x74, 0x61, 0x3a])) {
      return fixDataLine(line);
    }
    if (startsWithBytes(line, [0x65, 0x76, 0x65, 0x6e, 0x74, 0x3a])) {
      return fixFieldLine(line, [0x65, 0x76, 0x65, 0x6e, 0x74, 0x3a]);
    }
    if (startsWithBytes(line, [0x69, 0x64, 0x3a])) {
      return fixFieldLine(line, [0x69, 0x64, 0x3a]);
    }
    if (startsWithBytes(line, [0x72, 0x65, 0x74, 0x72, 0x79, 0x3a])) {
      return fixFieldLine(line, [0x72, 0x65, 0x74, 0x72, 0x79, 0x3a]);
    }
    if (startsWithBytes(line, [0x3a])) {
      return { line, applied: false };
    }

    if (looksLikeJsonLine(line)) {
      const out = new Uint8Array(6 + line.length);
      out.set([0x64, 0x61, 0x74, 0x61, 0x3a, 0x20], 0); // data:␠
      out.set(line, 6);
      return { line: out, applied: true };
    }

    const malformed = tryFixMalformed(line);
    if (malformed) return malformed;

    return { line, applied: false };
  }
}
