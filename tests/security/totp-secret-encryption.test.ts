import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetEnvConfig = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: mockGetEnvConfig,
}));

describe("TOTP secret encryption", () => {
  beforeEach(() => {
    mockGetEnvConfig.mockReturnValue({
      TOTP_SECRET_ENCRYPTION_KEY: "test-totp-secret-key",
      ADMIN_TOKEN: undefined,
    });
  });

  it("encrypts authenticator secrets before storage and decrypts them back", async () => {
    const { decryptTotpSecret, encryptTotpSecret } = await import(
      "@/lib/security/totp-secret-encryption"
    );

    const encrypted = encryptTotpSecret("JBSWY3DPEHPK3PXP");

    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext).not.toBe("JBSWY3DPEHPK3PXP");
    expect(encrypted.ciphertext).toMatch(/^v1:/);
    expect(decryptTotpSecret(encrypted.ciphertext)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("keeps legacy plaintext secrets readable", async () => {
    const { decryptTotpSecret } = await import("@/lib/security/totp-secret-encryption");

    expect(decryptTotpSecret("JBSWY3DPEHPK3PXP")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("requires a dedicated stable encryption key for new secrets", async () => {
    const { encryptTotpSecret, getTotpSecretKeySource, isTotpSecretEncryptionConfigured } =
      await import("@/lib/security/totp-secret-encryption");

    mockGetEnvConfig.mockReturnValue({
      TOTP_SECRET_ENCRYPTION_KEY: undefined,
      ADMIN_TOKEN: "admin-token-fallback",
    });

    expect(getTotpSecretKeySource()).toBe("admin-token");
    expect(isTotpSecretEncryptionConfigured()).toBe(false);
    expect(() => encryptTotpSecret("JBSWY3DPEHPK3PXP")).toThrow(
      "TOTP_SECRET_ENCRYPTION_KEY is required"
    );
  });

  it("throws a typed error when encrypted secrets cannot be authenticated", async () => {
    const { decryptTotpSecret, encryptTotpSecret, TotpSecretDecryptionError } = await import(
      "@/lib/security/totp-secret-encryption"
    );

    const encrypted = encryptTotpSecret("JBSWY3DPEHPK3PXP");
    mockGetEnvConfig.mockReturnValue({
      TOTP_SECRET_ENCRYPTION_KEY: "different-totp-secret-key",
      ADMIN_TOKEN: undefined,
    });

    expect(() => decryptTotpSecret(encrypted.ciphertext)).toThrow(TotpSecretDecryptionError);
  });
});
