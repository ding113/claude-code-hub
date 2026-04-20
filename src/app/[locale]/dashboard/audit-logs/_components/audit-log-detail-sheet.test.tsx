/**
 * @vitest-environment happy-dom
 */

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { AuditLogRow } from "@/types/audit-log";
import auditLogsMessages from "../../../../../../messages/en/auditLogs.json";

vi.mock("@/components/ui/sheet", () => {
  type PropsWithChildren = { children?: ReactNode };

  function Sheet({
    children,
    open,
  }: PropsWithChildren & { open?: boolean; onOpenChange?: (open: boolean) => void }) {
    return open ? <div data-slot="sheet-root">{children}</div> : null;
  }

  function SheetContent({ children }: PropsWithChildren) {
    return <div data-slot="sheet-content">{children}</div>;
  }

  function SheetHeader({ children }: PropsWithChildren) {
    return <div data-slot="sheet-header">{children}</div>;
  }

  function SheetTitle({ children }: PropsWithChildren) {
    return <div data-slot="sheet-title">{children}</div>;
  }

  return {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
  };
});

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <div data-slot="separator" />,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/relative-time", () => ({
  RelativeTime: ({ date }: { date: Date }) => <span>{date.toISOString()}</span>,
}));

vi.mock("@/app/[locale]/dashboard/_components/ip-display-trigger", () => ({
  IpDisplayTrigger: ({ ip }: { ip?: string | null }) => <span>{ip ?? "—"}</span>,
}));

vi.mock("@/app/[locale]/dashboard/_components/ip-details-dialog", () => ({
  IpDetailsDialog: () => null,
}));

import { AuditLogDetailSheet } from "./audit-log-detail-sheet";

const messages = { auditLogs: auditLogsMessages };

const SAMPLE_LOG: AuditLogRow = {
  id: 1,
  actionCategory: "auth",
  actionType: "login.success",
  targetType: "session",
  targetId: "sess_123",
  targetName: "Admin sign in",
  beforeValue: null,
  afterValue: { login: true },
  operatorUserId: 7,
  operatorUserName: "Alice",
  operatorKeyId: null,
  operatorKeyName: null,
  operatorIp: "127.0.0.1",
  userAgent: "Vitest",
  success: true,
  errorMessage: null,
  createdAt: new Date("2026-04-20T00:00:00.000Z"),
};

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("AuditLogDetailSheet", () => {
  test("translates dotted audit action types instead of showing the raw key", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AuditLogDetailSheet log={SAMPLE_LOG} open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );

    const text = document.body.textContent ?? "";

    expect(text).toContain("Login succeeded");
    expect(text).not.toContain("login.success");

    unmount();
  });

  test("falls back to the raw action type when no translation exists", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AuditLogDetailSheet
          log={{ ...SAMPLE_LOG, actionType: "totally.unknown" }}
          open
          onOpenChange={() => {}}
        />
      </NextIntlClientProvider>
    );

    const text = document.body.textContent ?? "";

    expect(text).toContain("totally.unknown");
    expect(text).not.toContain("auditLogs.actions.totally.unknown");

    unmount();
  });
});
