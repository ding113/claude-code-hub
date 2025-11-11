import type { ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";

const defaultMessages: AbstractIntlMessages = {
  common: {
    greeting: "你好，测试",
    loading: "加载中…",
    retry: "重试",
  },
};

export const mockMessages = defaultMessages;

type RenderWithIntlOptions = Omit<RenderOptions, "wrapper"> & {
  locale?: string;
  messages?: AbstractIntlMessages;
};

export function renderWithIntl(
  ui: ReactElement,
  { locale = "zh", messages = defaultMessages, ...renderOptions }: RenderWithIntlOptions = {}
) {
  return render(ui, {
    ...renderOptions,
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    ),
  });
}
