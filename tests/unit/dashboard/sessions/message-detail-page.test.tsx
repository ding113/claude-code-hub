import { isValidElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

const redirectMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: authMocks.getSession,
}));

vi.mock("@/i18n/routing", () => ({
  redirect: redirectMock,
}));

function MockSessionMessagesClient() {
  return null;
}

MockSessionMessagesClient.displayName = "SessionMessagesClient";

vi.mock(
  "@/app/[locale]/dashboard/sessions/[sessionId]/messages/_components/session-messages-client",
  () => ({
    SessionMessagesClient: MockSessionMessagesClient,
  })
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SessionMessagesPage", () => {
  test("renders SessionMessagesClient for admin users", async () => {
    authMocks.getSession.mockResolvedValue({
      user: {
        id: 1,
        role: "admin",
      },
    });

    const { default: SessionMessagesPage } = await import(
      "@/app/[locale]/dashboard/sessions/[sessionId]/messages/page"
    );
    const element = await SessionMessagesPage({
      params: Promise.resolve({ locale: "en", sessionId: "sess_x" }),
    });

    expect(isValidElement(element)).toBe(true);
    if (!isValidElement(element)) {
      throw new Error("SessionMessagesPage should return a React element");
    }

    expect(element.type).toBe(MockSessionMessagesClient);
  });

  test("redirects non-admin or unauthenticated users", async () => {
    authMocks.getSession.mockResolvedValueOnce(null).mockResolvedValueOnce({
      user: {
        id: 2,
        role: "user",
      },
    });

    const { default: SessionMessagesPage } = await import(
      "@/app/[locale]/dashboard/sessions/[sessionId]/messages/page"
    );

    await SessionMessagesPage({
      params: Promise.resolve({ locale: "en", sessionId: "sess_x" }),
    });
    expect(redirectMock).toHaveBeenCalledWith({ href: "/login", locale: "en" });

    await SessionMessagesPage({
      params: Promise.resolve({ locale: "ja", sessionId: "sess_x" }),
    });
    expect(redirectMock).toHaveBeenCalledWith({ href: "/dashboard", locale: "ja" });
  });
});
