import { describe, expect, test } from "vitest";

import enBigScreen from "../../../messages/en/bigScreen.json";
import jaBigScreen from "../../../messages/ja/bigScreen.json";
import ruBigScreen from "../../../messages/ru/bigScreen.json";
import zhCNBigScreen from "../../../messages/zh-CN/bigScreen.json";
import zhTWBigScreen from "../../../messages/zh-TW/bigScreen.json";

describe("messages/<locale>/bigScreen metadata keys", () => {
  test("provides pageTitle/pageDescription", () => {
    const all = [enBigScreen, jaBigScreen, ruBigScreen, zhCNBigScreen, zhTWBigScreen];

    for (const bigScreen of all) {
      expect(bigScreen).toHaveProperty("pageTitle");
      expect(bigScreen).toHaveProperty("pageDescription");
    }
  });
});
