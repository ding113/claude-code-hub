import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hasSecret } from "./secret-box";

describe("provider-site secret-box", () => {
  it("round-trips plaintext through AES-GCM", () => {
    const cipher = encryptSecret("hello-upstream-password");
    expect(cipher).toBeTruthy();
    expect(cipher?.startsWith("v1:")).toBe(true);
    expect(decryptSecret(cipher)).toBe("hello-upstream-password");
  });

  it("returns null for empty input", () => {
    expect(encryptSecret("")).toBeNull();
    expect(encryptSecret(null)).toBeNull();
    expect(decryptSecret(null)).toBeNull();
    expect(hasSecret(null)).toBe(false);
    expect(hasSecret("v1:x")).toBe(true);
  });

  it("keeps different ciphertexts for the same plaintext (random iv)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toEqual(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });
});
