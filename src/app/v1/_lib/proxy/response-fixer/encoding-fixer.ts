import type { FixResult } from "./types";

const UTF8_FATAL_DECODER = new TextDecoder("utf-8", { fatal: true });
const UTF8_LENIENT_DECODER = new TextDecoder("utf-8", { fatal: false });
const UTF8_ENCODER = new TextEncoder();

function hasUtf8Bom(data: Uint8Array): boolean {
  return data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
}

function hasUtf16Bom(data: Uint8Array): boolean {
  if (data.length < 2) return false;
  return (data[0] === 0xfe && data[1] === 0xff) || (data[0] === 0xff && data[1] === 0xfe);
}

function stripBom(data: Uint8Array): { data: Uint8Array; stripped: boolean; details?: string } {
  if (hasUtf8Bom(data)) {
    return { data: data.subarray(3), stripped: true, details: "removed_utf8_bom" };
  }
  if (hasUtf16Bom(data)) {
    return { data: data.subarray(2), stripped: true, details: "removed_utf16_bom" };
  }
  return { data, stripped: false };
}

function stripNullBytes(data: Uint8Array): { data: Uint8Array; stripped: boolean } {
  const firstNullIdx = data.indexOf(0);
  if (firstNullIdx < 0) {
    return { data, stripped: false };
  }

  let nullCount = 1;
  for (let i = firstNullIdx + 1; i < data.length; i += 1) {
    if (data[i] === 0) nullCount += 1;
  }

  const out = new Uint8Array(data.length - nullCount);
  out.set(data.subarray(0, firstNullIdx), 0);

  let offset = firstNullIdx;
  for (let i = firstNullIdx + 1; i < data.length; i += 1) {
    const b = data[i];
    if (b !== 0) {
      out[offset] = b;
      offset += 1;
    }
  }

  return { data: out, stripped: true };
}

function isValidUtf8(data: Uint8Array): boolean {
  try {
    // fatal=true 会在无效 UTF-8 时抛错
    UTF8_FATAL_DECODER.decode(data);
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
      const details = bom.details ?? (nul.stripped ? "removed_null_bytes" : undefined);
      return {
        data: intermediate,
        applied: changedByStrip,
        details,
      };
    }

    // 有损修复：用替换字符替代无效序列，再重新编码，确保输出一定是有效 UTF-8
    const lossyText = UTF8_LENIENT_DECODER.decode(intermediate);
    const encoded = UTF8_ENCODER.encode(lossyText);
    return { data: encoded, applied: true, details: "lossy_utf8_decode_encode" };
  }
}
