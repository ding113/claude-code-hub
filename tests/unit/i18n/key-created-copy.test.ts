import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Regression guards for two related issues:
 *
 * 1. The key-creation dialogs used to claim the full key is "only shown once" /
 *    "cannot be viewed again", but the dashboard allows owners and admins to
 *    reveal and copy the full key from the key list at any time
 *    (getUnmaskedKey / GET /api/v1/keys/{id}:reveal). The copy must describe
 *    the real behavior.
 *
 * 2. removeKey now reports failures through dedicated error codes; the errors
 *    namespace must carry translations for them in every locale so REST
 *    clients can render the real reason instead of a generic "Bad request".
 */

const LOCALES = ["zh-CN", "zh-TW", "en", "ja", "ru"] as const;

const COPY_PATHS: ReadonlyArray<readonly string[]> = [
  ["keyListHeader", "keyCreatedDialog", "description"],
  ["keyListHeader", "keyCreatedDialog", "warningText"],
  ["addKeyForm", "generatedKey", "hint"],
  ["userManagement", "createDialog", "keyHint"],
];

const ONE_TIME_CLAIM_PATTERNS: RegExp[] = [
  /仅显示一次/,
  /无法再次查看/,
  /僅顯示一次/,
  /無法再次檢視/,
  /only (?:be )?(?:displayed|shown) once/i,
  /not be able to view this key again/i,
  /一度だけ表示/,
  /一度しか表示されません/,
  /再度表示することはできません/,
  /только один раз/i,
  /не сможете снова просмотреть/i,
];

const REVIEWABLE_MARKERS: Record<(typeof LOCALES)[number], RegExp> = {
  "zh-CN": /重新查看/,
  "zh-TW": /重新檢視/,
  en: /view the full key again/i,
  ja: /再表示できます/,
  ru: /снова просмотреть/i,
};

function loadMessages(locale: string, file: string): Record<string, unknown> {
  const filePath = path.join(process.cwd(), "messages", locale, file);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getString(messages: Record<string, unknown>, keyPath: readonly string[]): string {
  let value: unknown = messages;
  for (const segment of keyPath) {
    expect(value, `missing segment "${segment}" in ${keyPath.join(".")}`).toBeTypeOf("object");
    value = (value as Record<string, unknown>)[segment];
  }
  expect(value, `value at ${keyPath.join(".")} must be a string`).toBeTypeOf("string");
  return value as string;
}

describe.each(LOCALES)("key creation copy (%s)", (locale) => {
  const dashboard = loadMessages(locale, "dashboard.json");

  test.each(
    COPY_PATHS.map((p) => [p.join("."), p] as const)
  )("%s matches the actual reveal behavior", (_label, keyPath) => {
    const copy = getString(dashboard, keyPath);

    expect(copy.trim().length).toBeGreaterThan(0);
    for (const pattern of ONE_TIME_CLAIM_PATTERNS) {
      expect(copy).not.toMatch(pattern);
    }
    expect(copy).toMatch(REVIEWABLE_MARKERS[locale]);
  });
});

describe.each(LOCALES)("removeKey error code translations (%s)", (locale) => {
  const errors = loadMessages(locale, "errors.json");

  test.each([
    "CANNOT_DELETE_LAST_KEY",
    "CANNOT_DELETE_LAST_GROUP_KEY",
  ])("errors namespace translates %s", (code) => {
    const value = errors[code];
    expect(value, `${locale}/errors.json must define ${code}`).toBeTypeOf("string");
    expect((value as string).trim().length).toBeGreaterThan(0);
    // Must be a distinct, specific message rather than a copy of a generic one.
    expect(value).not.toBe(errors.OPERATION_FAILED);
    expect(value).not.toBe(errors.DELETE_FAILED);
  });
});
