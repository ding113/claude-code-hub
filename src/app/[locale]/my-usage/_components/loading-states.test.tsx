import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import { QuotaCards } from "./quota-cards";
import { TodayUsageCard } from "./today-usage-card";

const messages = {
  myUsage: {
    quota: {},
    expiration: {},
    today: {
      title: "Today",
      autoRefresh: "Auto refresh {seconds}s",
      refresh: "Refresh",
      modelBreakdown: "Model breakdown",
    },
  },
  common: {
    loading: "Loading...",
  },
};

function renderWithIntl(node: ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>
  );
}

describe("my-usage loading states", () => {
  test("QuotaCards renders skeletons and loading label when loading", () => {
    const html = renderWithIntl(<QuotaCards quota={null} loading />);
    expect(html).toContain("Loading...");
    expect(html).toContain('data-slot="skeleton"');
  });

  test("TodayUsageCard renders skeletons and loading label when loading", () => {
    const html = renderWithIntl(<TodayUsageCard stats={null} loading autoRefreshSeconds={30} />);
    expect(html).toContain("Loading...");
    expect(html).toContain('data-slot="skeleton"');
  });
});
