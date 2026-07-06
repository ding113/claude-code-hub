/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import { PriceList } from "@/app/[locale]/settings/prices/_components/price-list";
import type { ModelPrice } from "@/types/model-price";
import { loadMessages } from "./test-messages";

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

describe("PriceList multi-provider pricing", () => {
  test("renders a multi-source badge and official pricing info for cloud rows", () => {
    const messages = loadMessages();
    const now = new Date("2026-03-06T00:00:00.000Z");

    const prices: ModelPrice[] = [
      {
        id: 1,
        modelName: "gpt-5.5",
        priceData: {
          mode: "responses",
          display_name: "GPT-5.5",
          model_family: "gpt",
          vendor: "openai",
          slug: "openai/gpt-5.5",
          official_pricing_provider: "openai",
          pricing: {
            openai: {
              official: true,
              input_cost_per_token: 0.0000025,
              output_cost_per_token: 0.000015,
            },
            openrouter: {
              input_cost_per_token: 0.0000025,
              output_cost_per_token: 0.000015,
            },
          },
        },
        source: "cloud",
        createdAt: now,
        updatedAt: now,
      },
    ];

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PriceList
          initialPrices={prices}
          initialTotal={prices.length}
          initialPage={1}
          initialPageSize={50}
          initialSearchTerm=""
          initialSourceFilter=""
          initialVendorFilter=""
        />
      </NextIntlClientProvider>
    );

    // 多来源徽标(badges.multiWithCount)与 vendor 徽标
    expect(document.body.textContent).toContain("2 sources");
    expect(document.body.textContent).toContain("openai");
    // 官方价徽标(badges.official)
    expect(document.body.textContent).toContain("Official");
    expect(document.body.textContent).toContain("$2.50/M");
    expect(document.body.textContent).toContain("$15.00/M");
    unmount();
  });
});
