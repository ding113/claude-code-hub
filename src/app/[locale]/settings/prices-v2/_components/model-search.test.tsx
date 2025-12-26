import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import { ModelSearch } from "./model-search";

const messages = {
  "prices-v2": {
    filters: {
      searchPlaceholder: "Search model name...",
      clear: "Clear filters",
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

describe("ModelSearch", () => {
  test("renders placeholder", () => {
    const html = renderWithIntl(<ModelSearch value="" onChange={vi.fn()} disabled={false} />);
    expect(html).toContain('placeholder="Search model name..."');
  });

  test("renders clear button when value is not empty", () => {
    const html = renderWithIntl(<ModelSearch value="gpt" onChange={vi.fn()} disabled={false} />);
    expect(html).toContain("Clear filters");
  });
});
