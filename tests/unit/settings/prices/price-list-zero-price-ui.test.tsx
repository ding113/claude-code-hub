/**
 * @vitest-environment happy-dom
 */

import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import { PriceList } from "@/app/[locale]/settings/prices/_components/price-list";
import type { ModelPrice } from "@/types/model-price";

function loadMessages() {
  const base = path.join(process.cwd(), "messages/en");
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(base, name), "utf8"));

  return {
    common: read("common.json"),
    errors: read("errors.json"),
    ui: read("ui.json"),
    forms: read("forms.json"),
    settings: read("settings.json"),
  };
}

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

describe("PriceList: formatPrice 应正确处理 0", () => {
  test("input/output 为 0 时应显示 0 而非占位符", () => {
    const messages = loadMessages();
    const now = new Date("2026-01-01T00:00:00.000Z");

    const prices: ModelPrice[] = [
      {
        id: 1,
        modelName: "zero-model",
        priceData: {
          mode: "chat",
          display_name: "Zero Model",
          input_cost_per_token: 0,
          output_cost_per_token: 0,
        },
        source: "litellm",
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
          initialLitellmProviderFilter=""
        />
      </NextIntlClientProvider>
    );

    expect(document.body.textContent).toContain("$0.0000/M");
    expect(document.body.textContent).not.toContain("$-/M");

    unmount();
  });
});
