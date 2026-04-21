import { describe, expect, it } from "vitest";
import { importPublicStatusModule } from "../../helpers/public-status-test-helpers";

interface PublicStatusRouteModule {
  GET(request: Request): Promise<Response>;
}

describe("GET /api/public-status", () => {
  it("reserves a Redis-only public route contract", async () => {
    const mod = await importPublicStatusModule<PublicStatusRouteModule>(
      "@/app/api/public-status/route"
    );

    const response = await mod.GET(
      new Request("http://localhost/api/public-status?locale=en&interval=5m&rangeHours=24")
    );

    expect(response).toBeInstanceOf(Response);
  });
});
