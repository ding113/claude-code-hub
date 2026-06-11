import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/lib/auth";
import { DashboardHeader } from "./dashboard-header";

vi.mock("next-intl/server", () => ({
  getTranslations: () => (key: string) =>
    ({
      availability: "Availability",
      dashboard: "Dashboard",
      documentation: "Docs",
      leaderboard: "Leaderboard",
      login: "Login",
      myQuota: "My Quota",
      providers: "Providers",
      quotasManagement: "Quotas",
      systemSettings: "Settings",
      usageLogs: "Usage Logs",
      userManagement: "Users",
    })[key] ?? key,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/customs/version-update-notifier", () => ({
  VersionUpdateNotifier: () => <span data-testid="version-update" />,
}));

vi.mock("@/components/ui/language-switcher", () => ({
  LanguageSwitcher: () => <span data-testid="language-switcher" />,
}));

vi.mock("@/components/ui/theme-switcher", () => ({
  ThemeSwitcher: () => <span data-testid="theme-switcher" />,
}));

vi.mock("./dashboard-nav", () => ({
  DashboardNav: ({ items }: { items: { href: string; label: string }[] }) => (
    <nav data-testid="desktop-nav">
      {items.map((item) => (
        <a href={item.href} key={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  ),
}));

vi.mock("./mobile-nav", () => ({
  MobileNav: ({ items }: { items: { href: string; label: string }[] }) => (
    <nav data-testid="mobile-nav">
      {items.map((item) => (
        <a href={item.href} key={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  ),
}));

vi.mock("./user-menu", () => ({
  UserMenu: ({ user }: { user: { name: string } }) => (
    <span data-testid="user-menu">{user.name}</span>
  ),
}));

function buildSession(canLoginWebUi: boolean): AuthSession {
  return {
    user: {
      id: 1,
      name: "Ada Lovelace",
      role: "user",
    },
    key: {
      id: 10,
      name: "readonly-key",
      key: "sk-readonly",
      userId: 1,
      canLoginWebUi,
    },
  } as AuthSession;
}

describe("DashboardHeader", () => {
  it("hides dashboard-only navigation for readonly usage sessions", async () => {
    const html = renderToString(
      await DashboardHeader({ session: buildSession(false), locale: "en" })
    );

    expect(html).toContain('href="/usage-doc"');
    expect(html).not.toContain('href="/dashboard/logs"');
    expect(html).not.toContain('href="/dashboard/users"');
  });

  it("keeps normal dashboard navigation for full web UI sessions", async () => {
    const html = renderToString(
      await DashboardHeader({ session: buildSession(true), locale: "en" })
    );

    expect(html).toContain('href="/dashboard/logs"');
    expect(html).toContain('href="/dashboard/my-quota"');
    expect(html).toContain('href="/usage-doc"');
  });
});
