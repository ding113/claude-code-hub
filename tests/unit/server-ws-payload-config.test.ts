import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { defaultLocale, locales } from "@/i18n/config";

const requireFromHere = createRequire(import.meta.url);
const { readResponsesWsPayloadLimits } = requireFromHere("../../server-lib/responses-ws-payload");
const { resolveWsErrorLocale, formatWsPayloadTooLargeMessage } = requireFromHere(
  "../../server-lib/responses-ws-error-message"
);
const MIB = 1024 * 1024;
const fields = ["CLIENT_SOFT_LIMIT", "ABSOLUTE_REQUEST_LIMIT", "HARD_MAX_PAYLOAD", "MAX_PENDING"];

describe("Responses WS payload configuration", () => {
  it("defaults to 32 / 100 / 128 MiB with a 128 MiB queue", () => {
    const limits = readResponsesWsPayloadLimits({});
    expect(limits).toEqual({
      soft: 32 * MIB,
      absolute: 100 * MIB,
      hard: 128 * MIB,
      pending: 128 * MIB,
    });
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it.each(["", " ", "invalid", "0", "-1", "Infinity", "NaN", "1e99", "0.00000001"])(
    "uses defaults for invalid setting %s",
    (value) => {
      const env = Object.fromEntries(
        fields.map((field) => [`CCH_RESPONSES_WS_${field}_MIB`, value])
      );
      expect(readResponsesWsPayloadLimits(env)).toEqual(readResponsesWsPayloadLimits({}));
    }
  );

  it("accepts fractional MiB and maintains soft <= absolute <= hard <= pending", () => {
    expect(
      readResponsesWsPayloadLimits({
        CCH_RESPONSES_WS_CLIENT_SOFT_LIMIT_MIB: "3",
        CCH_RESPONSES_WS_ABSOLUTE_REQUEST_LIMIT_MIB: "0.5",
        CCH_RESPONSES_WS_HARD_MAX_PAYLOAD_MIB: "0.25",
        CCH_RESPONSES_WS_MAX_PENDING_MIB: "0.125",
      })
    ).toEqual({ soft: MIB / 2, absolute: MIB / 2, hard: MIB / 2, pending: MIB / 2 });
  });
});

describe("Responses WS terminal error translations", () => {
  it.each(locales)("formats the payload limit message in %s", (locale) => {
    const message = formatWsPayloadTooLargeMessage(
      { "accept-language": locale },
      101 * MIB,
      100 * MIB
    );
    const template = requireFromHere(
      `../../messages/${locale}/errors.json`
    ).RESPONSES_WS_REQUEST_TOO_LARGE;
    expect(message).toBe(template.replace("{actualMiB}", "101.00").replace("{limitMiB}", "100.00"));
    expect(message).not.toContain("RESPONSES_WS_REQUEST_TOO_LARGE");
  });

  it("prefers NEXT_LOCALE over Accept-Language", () => {
    expect(
      resolveWsErrorLocale({ cookie: "foo=bar; NEXT_LOCALE=zh%2DTW", "accept-language": "en" })
    ).toBe("zh-TW");
  });

  it("uses language quality weights and region variants", () => {
    expect(resolveWsErrorLocale({ "accept-language": "ru;q=0.3,en-US;q=0.9,ja;q=0" })).toBe("en");
    expect(resolveWsErrorLocale({ "accept-language": "xx,ja-JP;q=0.8" })).toBe("ja");
  });

  it.each(["NEXT_LOCALE=%zz", "NEXT_LOCALE=xx", "NEXT_LOCALE", "else=en"])(
    "ignores invalid cookie %s",
    (cookie) => {
      expect(resolveWsErrorLocale({ cookie, "accept-language": "ru" })).toBe("ru");
    }
  );

  it("uses the application default for missing or unsupported language preferences", () => {
    expect(resolveWsErrorLocale()).toBe(defaultLocale);
    expect(resolveWsErrorLocale({ "accept-language": "en;q=bad,ru;q=2,*;q=0" })).toBe(
      defaultLocale
    );
    expect(resolveWsErrorLocale({ cookie: [], "accept-language": [] })).toBe(defaultLocale);
  });
});
