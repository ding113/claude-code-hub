import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const LOCALES = ["zh-CN", "zh-TW", "en", "ja", "ru"] as const;
const ERROR_CODES = [
  "SESSION_REQUEST_SOURCE_MISMATCH",
  "SESSION_REQUEST_SELECTOR_INCOMPLETE",
] as const;

describe.each(LOCALES)("session request locator errors (%s)", (locale) => {
  const errors = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "messages", locale, "errors.json"), "utf8")
  ) as Record<string, unknown>;

  test.each(ERROR_CODES)("translates %s", (code) => {
    const value = errors[code];
    expect(value, `${locale}/errors.json must define ${code}`).toBeTypeOf("string");
    expect((value as string).trim().length).toBeGreaterThan(0);
    expect(value).not.toBe(errors.OPERATION_FAILED);
  });
});
