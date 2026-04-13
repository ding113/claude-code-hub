import { beforeEach, describe, expect, it, vi } from "vitest";

// -- mocks --

const mocks = vi.hoisted(() => ({
  handleReadinessRequest: vi.fn(),
}));

vi.mock("@/lib/health/checker", () => ({
  handleReadinessRequest: mocks.handleReadinessRequest,
}));

// helper: create NextResponse-like object
function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// -- liveness --

describe("GET /api/health/live", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 200 with alive status", async () => {
    const { GET } = await import("@/app/api/health/live/route");
    const response = GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("alive");
    expect(body.timestamp).toBeDefined();
  });
});

// -- readiness --

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 200 for healthy", async () => {
    mocks.handleReadinessRequest.mockResolvedValue(
      jsonResponse({ status: "healthy", version: "0.6.8" }, 200)
    );
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("healthy");
  });

  it("returns 200 for degraded", async () => {
    mocks.handleReadinessRequest.mockResolvedValue(
      jsonResponse({ status: "degraded", version: "0.6.8" }, 200)
    );
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("degraded");
  });

  it("returns 503 for unhealthy", async () => {
    mocks.handleReadinessRequest.mockResolvedValue(jsonResponse({ status: "unhealthy" }, 503));
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("unhealthy");
  });
});

// -- combined /api/health --

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 200 for healthy", async () => {
    mocks.handleReadinessRequest.mockResolvedValue(
      jsonResponse({ status: "healthy", version: "0.6.8" }, 200)
    );
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it("returns 503 for unhealthy", async () => {
    mocks.handleReadinessRequest.mockResolvedValue(jsonResponse({ status: "unhealthy" }, 503));
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(503);
  });
});
