import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import { OverrideBadge } from "./override-badge";

const messages = {
  "prices-v2": {
    table: {
      isUserOverride: "Override",
    },
  },
};

function renderWithIntl(node: ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>
  );
}

describe("OverrideBadge", () => {
  test("renders nothing when not override", () => {
    const html = renderWithIntl(<OverrideBadge isUserOverride={false} />);
    expect(html).toBe("");
  });

  test("renders badge when override", () => {
    const html = renderWithIntl(<OverrideBadge isUserOverride />);
    expect(html).toContain("Override");
    expect(html).toContain('data-slot="badge"');
  });
});
