import { describe, expect, it } from "vitest";
import { importPublicStatusModule } from "../../helpers/public-status-test-helpers";

interface ConfigPublisherModule {
  publishPublicStatusConfigSnapshot(input: {
    reason: string;
  }): Promise<{
    configVersion: string;
  }>;
}

describe("public-status config publish integration", () => {
  it("requires a control-plane publisher for public-safe config snapshots", async () => {
    const mod = await importPublicStatusModule<ConfigPublisherModule>(
      "@/lib/public-status/config-snapshot"
    );

    const result = await mod.publishPublicStatusConfigSnapshot({
      reason: "task-1-red-test",
    });

    expect(result.configVersion).toBeTruthy();
  });
});
