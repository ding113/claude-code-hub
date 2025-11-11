import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProxyAuthenticator } from "./auth-guard";
import { ProxySession } from "./session";
import type { User } from "@/types/user";
import type { Key } from "@/types/key";

// Mock the repository module
vi.mock("@/repository/key", () => ({
  validateApiKeyAndGetUser: vi.fn(),
}));

// Mock the responses module
vi.mock("./responses", () => ({
  ProxyResponses: {
    buildError: vi.fn((status: number, message: string) => {
      return new Response(
        JSON.stringify({
          error: {
            message,
            type: String(status),
          },
        }),
        {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        }
      );
    }),
  },
}));

import { validateApiKeyAndGetUser } from "@/repository/key";
import { ProxyResponses } from "./responses";

describe("ProxyAuthenticator", () => {
  const mockUser: User = {
    id: 1,
    name: "test-user",
    description: "Test User",
    role: "user",
    rpmLimit: 100,
    dailyLimitUsd: 10,
    providerGroup: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockKey: Key = {
    id: 1,
    userId: 1,
    key: "test-key-123",
    name: "Test Key",
    isEnabled: true,
    expiresAt: null,
    canLoginWebUi: false,
    limit5hUsd: null,
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitConcurrentSessions: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ensure", () => {
    it("should return null when authentication succeeds", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer test-key-123",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeNull();
      expect(mockSession.setAuthState).toHaveBeenCalledWith({
        user: mockUser,
        key: mockKey,
        apiKey: "test-key-123",
        success: true,
      });
    });

    it("should return 401 error response when authentication fails", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer invalid-key",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue(null);

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(mockSession.setAuthState).toHaveBeenCalledWith({
        user: null,
        key: null,
        apiKey: "invalid-key",
        success: false,
      });

      const body = await result?.json();
      expect(body).toEqual({
        error: {
          message: "令牌已过期或验证不正确",
          type: "401",
        },
      });
    });

    it("should handle missing authorization header", async () => {
      const mockSession = {
        headers: new Headers(),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(mockSession.setAuthState).toHaveBeenCalledWith({
        user: null,
        key: null,
        apiKey: null,
        success: false,
      });
      expect(validateApiKeyAndGetUser).not.toHaveBeenCalled();
    });

    it("should validate x-api-key header", async () => {
      const mockSession = {
        headers: new Headers({
          "x-api-key": "test-key-123",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeNull();
      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith("test-key-123");
    });

    it("should detect mismatched keys between authorization and x-api-key", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer key-1",
          "x-api-key": "key-2",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(mockSession.setAuthState).toHaveBeenCalledWith({
        user: null,
        key: null,
        apiKey: null,
        success: false,
      });
      expect(validateApiKeyAndGetUser).not.toHaveBeenCalled();
    });

    it("should accept matching keys from both headers", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer test-key-123",
          "x-api-key": "test-key-123",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeNull();
      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith("test-key-123");
      expect(validateApiKeyAndGetUser).toHaveBeenCalledTimes(1);
    });
  });

  describe("extractKeyFromAuthorization", () => {
    it("should extract key from valid Bearer token", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer valid-key",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      await ProxyAuthenticator.ensure(mockSession);

      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith("valid-key");
    });

    it("should handle case-insensitive Bearer keyword", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "bearer lowercase-key",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      await ProxyAuthenticator.ensure(mockSession);

      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith("lowercase-key");
    });

    it("should handle authorization with extra whitespace", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "  Bearer   key-with-spaces   ",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      await ProxyAuthenticator.ensure(mockSession);

      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith("key-with-spaces");
    });

    it("should reject authorization without Bearer prefix", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "just-a-key",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(validateApiKeyAndGetUser).not.toHaveBeenCalled();
    });

    it("should reject empty authorization header", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(validateApiKeyAndGetUser).not.toHaveBeenCalled();
    });

    it("should reject authorization with only whitespace", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "   ",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(validateApiKeyAndGetUser).not.toHaveBeenCalled();
    });

    it("should reject Bearer with empty token", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer ",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(validateApiKeyAndGetUser).not.toHaveBeenCalled();
    });

    it("should reject Bearer with only whitespace token", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer    ",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(validateApiKeyAndGetUser).not.toHaveBeenCalled();
    });

    it("should handle authorization with tab characters", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "\tBearer\t\ttest-key\t",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      await ProxyAuthenticator.ensure(mockSession);

      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith("test-key");
    });
  });

  describe("normalizeKey", () => {
    it("should normalize valid x-api-key header", async () => {
      const mockSession = {
        headers: new Headers({
          "x-api-key": "  trimmed-key  ",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      await ProxyAuthenticator.ensure(mockSession);

      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith("trimmed-key");
    });

    it("should reject empty x-api-key header", async () => {
      const mockSession = {
        headers: new Headers({
          "x-api-key": "",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(validateApiKeyAndGetUser).not.toHaveBeenCalled();
    });

    it("should reject x-api-key with only whitespace", async () => {
      const mockSession = {
        headers: new Headers({
          "x-api-key": "   ",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(validateApiKeyAndGetUser).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle database returning null for valid-looking key", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer expired-key",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue(null);

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(mockSession.setAuthState).toHaveBeenCalledWith({
        user: null,
        key: null,
        apiKey: "expired-key",
        success: false,
      });
    });

    it("should handle special characters in API key", async () => {
      const specialKey = "key-with-!@#$%^&*()";
      const mockSession = {
        headers: new Headers({
          authorization: `Bearer ${specialKey}`,
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      await ProxyAuthenticator.ensure(mockSession);

      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith(specialKey);
    });

    it("should handle very long API key", async () => {
      const longKey = "a".repeat(1000);
      const mockSession = {
        headers: new Headers({
          authorization: `Bearer ${longKey}`,
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      await ProxyAuthenticator.ensure(mockSession);

      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith(longKey);
    });

    it("should handle API key with hyphens and numbers", async () => {
      const complexKey = "sk-abc123-def456-ghi789";
      const mockSession = {
        headers: new Headers({
          authorization: `Bearer ${complexKey}`,
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      await ProxyAuthenticator.ensure(mockSession);

      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith(complexKey);
    });

    it("should handle database error gracefully", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer test-key",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockRejectedValue(new Error("Database connection error"));

      await expect(ProxyAuthenticator.ensure(mockSession)).rejects.toThrow(
        "Database connection error"
      );
    });
  });

  describe("authorization priority", () => {
    it("should use first available key when both headers present with same value", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer same-key",
          "x-api-key": "same-key",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      await ProxyAuthenticator.ensure(mockSession);

      expect(validateApiKeyAndGetUser).toHaveBeenCalledTimes(1);
      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith("same-key");
    });

    it("should prefer authorization header when both present", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer auth-key",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      await ProxyAuthenticator.ensure(mockSession);

      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith("auth-key");
    });

    it("should use x-api-key when authorization header is invalid", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "InvalidFormat no-bearer",
          "x-api-key": "valid-key",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: mockUser,
        key: mockKey,
      });

      await ProxyAuthenticator.ensure(mockSession);

      expect(validateApiKeyAndGetUser).toHaveBeenCalledWith("valid-key");
    });

    it("should fail when authorization is invalid and x-api-key is empty", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "InvalidFormat",
          "x-api-key": "   ",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
      expect(validateApiKeyAndGetUser).not.toHaveBeenCalled();
    });
  });

  describe("ProxyResponses integration", () => {
    it("should call ProxyResponses.buildError with correct parameters", async () => {
      const mockSession = {
        headers: new Headers(),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      const buildErrorSpy = vi.mocked(ProxyResponses.buildError);

      await ProxyAuthenticator.ensure(mockSession);

      expect(buildErrorSpy).toHaveBeenCalledWith(401, "令牌已过期或验证不正确");
    });

    it("should return Response object from ProxyResponses", async () => {
      const mockSession = {
        headers: new Headers({
          authorization: "Bearer invalid",
        }),
        setAuthState: vi.fn(),
      } as unknown as ProxySession;

      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue(null);

      const result = await ProxyAuthenticator.ensure(mockSession);

      expect(result).toBeInstanceOf(Response);
      expect(result?.headers.get("content-type")).toBe("application/json; charset=utf-8");
    });
  });
});
