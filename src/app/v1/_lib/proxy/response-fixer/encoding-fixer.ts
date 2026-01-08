import type { FixResult } from "./types";

function hasUtf8Bom(data: Uint8Array): boolean {
  return data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
}

function hasUtf16Bom(data: Uint8Array): boolean {
  if (data.length < 2) return false;
  return (data[0] === 0xfe && data[1] === 0xff) || (data[0] === 0xff && data[1] === 0xfe);
}

function stripBom(data: Uint8Array): { data: Uint8Array; stripped: boolean; details?: string } {
  if (hasUtf8Bom(data)) {
    return { data: data.subarray(3), stripped: true, details: "removed utf-8 bom" };
  }
  if (hasUtf16Bom(data)) {
    return { data: data.subarray(2), stripped: true, details: "removed utf-16 bom" };
  }
  return { data, stripped: false };
}

function stripNullBytes(data: Uint8Array): { data: Uint8Array; stripped: boolean } {
  const firstNullIdx = data.indexOf(0);
  if (firstNullIdx < 0) {
    return { data, stripped: false };
  }
  const out: number[] = [];
  out.length = 0;
  for (const b of data) {
    if (b !== 0) out.push(b);
  }
  return { data: Uint8Array.from(out), stripped: true };
}

function isValidUtf8(data: Uint8Array): boolean {
  try {
    // fatal=true 会在无效 UTF-8 时抛错
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

export class EncodingFixer {
  canFix(data: Uint8Array): boolean {
    if (hasUtf8Bom(data) || hasUtf16Bom(data)) return true;
    if (data.includes(0)) return true;
    return !isValidUtf8(data);
  }

  fix(input: Uint8Array): FixResult<Uint8Array> {
    if (!this.canFix(input)) {
      return { data: input, applied: false };
    }

    const bom = stripBom(input);
    const nul = stripNullBytes(bom.data);

    const intermediate = nul.data;
    const changedByStrip = bom.stripped || nul.stripped;

    // 经过 BOM/空字节清理后已经是有效 UTF-8
    if (isValidUtf8(intermediate)) {
      return {
        data: intermediate,
        applied: changedByStrip,
        details: bom.details,
      };
    }

    // 有损修复：用替换字符替代无效序列，再重新编码，确保输出一定是有效 UTF-8
    const lossyText = new TextDecoder("utf-8", { fatal: false }).decode(intermediate);
    const encoded = new TextEncoder().encode(lossyText);
    return { data: encoded, applied: true, details: "lossy utf-8 decode/encode" };
  }
}
