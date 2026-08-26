/** 返回不拆开 UTF-16 代理对的有界切片终点。 */
export function splitAtSafeTextBoundary(
  text: string,
  offset: number,
  maxCharacters: number
): number {
  let end = Math.min(text.length, offset + maxCharacters);
  if (end >= text.length) return end;

  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    end -= 1;
  }
  return end;
}
