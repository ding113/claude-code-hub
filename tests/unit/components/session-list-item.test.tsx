/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { SessionListItem } from "@/components/customs/session-list-item";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ActiveSessionInfo } from "@/types/session";

vi.mock("@/i18n/routing", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/utils/currency", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/utils/currency")>("@/lib/utils/currency");
  return {
    ...actual,
    formatCurrency: () => "__COST__",
  };
});

const UP_ARROW = "\u2191";
const DOWN_ARROW = "\u2193";
const COST_SENTINEL = "__COST__";

type SessionListItemProps = {
  session: ActiveSessionInfo;
  currencyCode?: CurrencyCode;
  showTokensCost?: boolean;
};

const SessionListItemTest = SessionListItem as unknown as (
  props: SessionListItemProps
) => JSX.Element;

const baseSession: ActiveSessionInfo = {
  sessionId: "session-1",
  userName: "alice",
  userId: 1,
  keyId: 2,
  keyName: "key-1",
  providerId: 3,
  providerName: "openai",
  model: "gpt-4.1",
  apiType: "chat",
  startTime: 1700000000000,
  status: "completed",
  durationMs: 1500,
  inputTokens: 100,
  outputTokens: 50,
  costUsd: "0.0123",
};

function renderTextContent(options?: {
  showTokensCost?: boolean;
  sessionOverrides?: Partial<ActiveSessionInfo>;
}) {
  const session = { ...baseSession, ...(options?.sessionOverrides ?? {}) };
  const html = renderToStaticMarkup(
    <SessionListItemTest session={session} showTokensCost={options?.showTokensCost} />
  );
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.textContent ?? "";
}

describe("SessionListItem showTokensCost", () => {
  test("hides tokens and cost when disabled but keeps core fields", () => {
    const text = renderTextContent({ showTokensCost: false });

    expect(text).not.toContain(`${UP_ARROW}100`);
    expect(text).not.toContain(`${DOWN_ARROW}50`);
    expect(text).not.toContain(COST_SENTINEL);

    expect(text).toContain("alice");
    expect(text).toContain("key-1");
    expect(text).toContain("gpt-4.1");
    expect(text).toContain("@ openai");
    expect(text).toContain("1.5s");
  });

  test("shows tokens and cost by default", () => {
    const text = renderTextContent();

    expect(text).toContain(`${UP_ARROW}100`);
    expect(text).toContain(`${DOWN_ARROW}50`);
    expect(text).toContain(COST_SENTINEL);
  });
});
