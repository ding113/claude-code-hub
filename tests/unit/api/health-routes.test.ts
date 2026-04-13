import { beforeEach, describe, expect, it, vi } from "vitest";

// -- mocks --

const mocks = vi.hoisted(() => ({
  checkReadiness: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/health/checker", () => ({
  checkReadiness: mocks.checkReadiness,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.loggerError },
}));

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
    mocks.checkReadiness.mockResolvedValue({
      status: "healthy",
      timestamp: "2026-04-13T00:00:00.000Z",
      version: "0.6.8",
      uptime: 100,
      components: {
        database: { status: "up", latencyMs: 1 },
        redis: { status: "up", latencyMs: 1 },
        proxy: { status: "up", latencyMs: 1 },
      },
    });
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("healthy");
  });

  it("returns 200 for degraded", async () => {
    mocks.checkReadiness.mockResolvedValue({
      status: "degraded",
      timestamp: "2026-04-13T00:00:00.000Z",
      version: "0.6.8",
      uptime: 100,
      components: {
        database: { status: "up", latencyMs: 1 },
        redis: { status: "down", message: "timeout" },
        proxy: { status: "up", latencyMs: 1 },
      },
    });
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("degraded");
  });

  it("returns 503 for unhealthy", async () => {
    mocks.checkReadiness.mockResolvedValue({
      status: "unhealthy",
      timestamp: "2026-04-13T00:00:00.000Z",
      version: "0.6.8",
      uptime: 100,
      components: {
        database: { status: "down", message: "connection refused" },
        redis: { status: "up", latencyMs: 1 },
        proxy: { status: "up", latencyMs: 1 },
      },
    });
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("unhealthy");
  });

  it("returns 503 when checkReadiness throws", async () => {
    mocks.checkReadiness.mockRejectedValue(new Error("unexpected"));
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
    mocks.checkReadiness.mockResolvedValue({
      status: "healthy",
      timestamp: "2026-04-13T00:00:00.000Z",
      version: "0.6.8",
      uptime: 100,
      components: {
        database: { status: "up", latencyMs: 1 },
        redis: { status: "up", latencyMs: 1 },
        proxy: { status: "up", latencyMs: 1 },
      },
    });
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it("returns 503 for unhealthy", async () => {
    mocks.checkReadiness.mockResolvedValue({
      status: "unhealthy",
      timestamp: "2026-04-13T00:00:00.000Z",
      version: "0.6.8",
      uptime: 100,
      components: {
        database: { status: "down", message: "connection refused" },
        redis: { status: "down", message: "timeout" },
        proxy: { status: "down", message: "middleware crashed" },
      },
    });
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(503);
  });
});
