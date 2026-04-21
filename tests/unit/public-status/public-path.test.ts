import { describe, expect, it } from "vitest";
import { readRepoFile } from "../../helpers/public-status-test-helpers";

describe("public status proxy path", () => {
  it("keeps /status in the public path allowlist", async () => {
    const source = await readRepoFile("src/proxy.ts");
    expect(source).toContain('"/status"');
  });
});
