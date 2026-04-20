/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import { ModelPriceDetailsDialog } from "@/app/[locale]/settings/prices/_components/model-price-details-dialog";
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

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ModelPriceDetailsDialog", () => {
  test("renders core fields and additional billable/provider fields", async () => {
    const messages = loadMessages();
    const pricingMessages = messages.settings.prices as Record<string, unknown>;
    const actionMessages = pricingMessages.actions as Record<string, string>;
    const detailsMessages = pricingMessages.details as Record<string, string>;
    const now = new Date("2026-01-01T00:00:00.000Z");
    const price: ModelPrice = {
      id: 1,
      modelName: "demo-model",
      priceData: {
        mode: "chat",
        display_name: "Demo Model",
        input_cost_per_request: 0.25,
        input_cost_per_second: 0.5,
        supports_reasoning: true,
        pricing: {
          openai: {
            input_cost_per_token: 0.0000025,
            file_search_cost_per_1k_calls: 2,
          },
        },
      },
      source: "manual",
      createdAt: now,
      updatedAt: now,
    };

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ModelPriceDetailsDialog price={price} />
      </NextIntlClientProvider>
    );

    const trigger = Array.from(document.querySelectorAll("button")).find((element) =>
      element.textContent?.includes(actionMessages.viewDetails)
    );
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(document.body.textContent).toContain(detailsMessages.coreFieldsTitle);
    expect(document.body.textContent).toContain("input_cost_per_request");
    expect(document.body.textContent).toContain(detailsMessages.additionalBillableTitle);
    expect(document.body.textContent).toContain("pricing.openai.file_search_cost_per_1k_calls");

    unmount();
  });
});
