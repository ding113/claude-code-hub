import type { FixResult } from "./types";

const UTF8_DECODER = new TextDecoder();

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function looksLikeJson(data: Uint8Array): boolean {
  for (const b of data) {
    if (isWhitespace(b)) continue;
    return b === 0x7b /* { */ || b === 0x5b /* [ */;
  }
  return false;
}

function removeTrailingComma(bytes: number[]): void {
  let idx = bytes.length - 1;
  while (idx >= 0 && isWhitespace(bytes[idx])) idx -= 1;
  if (idx >= 0 && bytes[idx] === 0x2c /* , */) {
    bytes.length = idx;
  }
}

function needsNullValue(bytes: number[], stack: number[]): boolean {
  // 仅对象内（等待闭合 '}'）才可能出现 "key":<EOF> 这种情况
  if (stack.length === 0 || stack[stack.length - 1] !== 0x7d /* } */) {
    return false;
  }

  let idx = bytes.length - 1;
  while (idx >= 0 && isWhitespace(bytes[idx])) idx -= 1;
  return idx >= 0 && bytes[idx] === 0x3a /* : */;
}

export type JsonFixerConfig = {
  maxDepth: number;
  maxSize: number;
};

export class JsonFixer {
  private readonly maxDepth: number;
  private readonly maxSize: number;

  constructor(config: JsonFixerConfig) {
    this.maxDepth = config.maxDepth;
    this.maxSize = config.maxSize;
  }

  canFix(data: Uint8Array): boolean {
    return looksLikeJson(data);
  }

  fix(data: Uint8Array): FixResult<Uint8Array> {
    if (data.length > this.maxSize) {
      return { data, applied: false, details: "exceeded_max_size" };
    }

    if (!this.canFix(data)) {
      return { data, applied: false };
    }

    // 快速路径：有效 JSON 直接返回
    try {
      JSON.parse(UTF8_DECODER.decode(data));
      return { data, applied: false };
    } catch {
      // fallthrough
    }

    // 慢速路径：修复并验证
    const repaired = this.repair(data);
    if (!repaired) {
      return { data, applied: false, details: "repair_failed" };
    }

    try {
      JSON.parse(UTF8_DECODER.decode(repaired));
      return { data: repaired, applied: true };
    } catch {
      return { data, applied: false, details: "validate_repaired_failed" };
    }
  }

  private repair(data: Uint8Array): Uint8Array | null {
    const out: number[] = [];
    const stack: number[] = [];

    let inString = false;
    let escapeNext = false;
    let depth = 0;

    for (const byte of data) {
      if (escapeNext) {
        escapeNext = false;
        out.push(byte);
        continue;
      }

      if (inString && byte === 0x5c /* \\ */) {
        escapeNext = true;
        out.push(byte);
        continue;
      }

      if (byte === 0x22 /* \" */) {
        inString = !inString;
        out.push(byte);
        continue;
      }

      if (!inString) {
        if (byte === 0x7b /* { */) {
          depth += 1;
          if (depth > this.maxDepth) {
            return null;
          }
          stack.push(0x7d /* } */);
          out.push(byte);
          continue;
        }

        if (byte === 0x5b /* [ */) {
          depth += 1;
          if (depth > this.maxDepth) {
            return null;
          }
          stack.push(0x5d /* ] */);
          out.push(byte);
          continue;
        }

        if (byte === 0x7d /* } */) {
          removeTrailingComma(out);
          if (stack.length > 0 && stack[stack.length - 1] === byte) {
            stack.pop();
            depth = Math.max(0, depth - 1);
            out.push(byte);
          }
          continue;
        }

        if (byte === 0x5d /* ] */) {
          removeTrailingComma(out);
          if (stack.length > 0 && stack[stack.length - 1] === byte) {
            stack.pop();
            depth = Math.max(0, depth - 1);
            out.push(byte);
          }
          continue;
        }
      }

      out.push(byte);
    }

    // 末尾不完整的转义序列：去掉最后一个反斜杠
    if (escapeNext) {
      out.pop();
    }

    // 闭合未关闭的字符串
    if (inString) {
      out.push(0x22 /* \" */);
    }

    removeTrailingComma(out);

    // 对象末尾冒号无值：补 null
    if (needsNullValue(out, stack)) {
      out.push(0x6e /* n */);
      out.push(0x75 /* u */);
      out.push(0x6c /* l */);
      out.push(0x6c /* l */);
    }

    // 闭合所有未关闭结构
    while (stack.length > 0) {
      removeTrailingComma(out);
      out.push(stack.pop() as number);
    }

    return Uint8Array.from(out);
  }
}
