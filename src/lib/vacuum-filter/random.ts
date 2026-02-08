type WebCryptoLike = {
  getRandomValues(bytes: Uint8Array): Uint8Array;
};

function getWebCrypto(): WebCryptoLike | null {
  const c = (globalThis as unknown as { crypto?: WebCryptoLike }).crypto;
  return c && typeof c.getRandomValues === "function" ? c : null;
}

export function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  const webCrypto = getWebCrypto();
  if (webCrypto) {
    webCrypto.getRandomValues(out);
    return out;
  }

  // 兜底：极端环境无 Web Crypto 时，使用 Math.random（仅用于 seed，不影响正确性）
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}
