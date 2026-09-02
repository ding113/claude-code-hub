import { describe, expect, it } from "vitest";
import { shouldRunBackgroundTasks } from "@/instrumentation";

describe("instrumentation multicore role gating", () => {
  it("preserves standalone and external-replica startup behavior by default", () => {
    expect(shouldRunBackgroundTasks({})).toBe(true);
    expect(shouldRunBackgroundTasks({ CCH_MULTICORE_BACKGROUND_OWNER: "1" })).toBe(true);
  });

  it("disables singleton schedulers only for an explicitly marked request worker", () => {
    expect(shouldRunBackgroundTasks({ CCH_MULTICORE_BACKGROUND_OWNER: "0" })).toBe(false);
    expect(shouldRunBackgroundTasks({ CCH_MULTICORE_BACKGROUND_OWNER: "false" })).toBe(true);
  });
});
