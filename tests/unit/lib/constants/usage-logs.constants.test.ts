import { describe, expect, test } from "vitest";

import {
  SESSION_ID_SUGGESTION_LIMIT,
  SESSION_ID_SUGGESTION_MAX_LEN,
  SESSION_ID_SUGGESTION_MIN_LEN,
} from "@/lib/constants/usage-logs.constants";

describe("Usage logs constants", () => {
  test("SESSION_ID_SUGGESTION_* 常量保持稳定（避免前后端阈值漂移）", () => {
    expect(SESSION_ID_SUGGESTION_MIN_LEN).toBe(2);
    expect(SESSION_ID_SUGGESTION_MAX_LEN).toBe(128);
    expect(SESSION_ID_SUGGESTION_LIMIT).toBe(20);
  });
});
