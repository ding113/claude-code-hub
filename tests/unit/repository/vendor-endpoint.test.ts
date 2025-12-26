import { beforeEach, describe, expect, test, vi } from "vitest";

let insertedEndpointValues: unknown;
let selectedEndpoints: unknown[] = [];
let updatedEndpoints: unknown[] = [];

vi.mock("@/drizzle/db", () => {
  const insertReturningMock = vi.fn(async () => selectedEndpoints);
  const insertValuesMock = vi.fn((values: unknown) => {
    insertedEndpointValues = values;
    return { returning: insertReturningMock };
  });
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const selectWhereMock = vi.fn(() => Promise.resolve(selectedEndpoints));
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const updateReturningMock = vi.fn(async () => updatedEndpoints);
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  return {
    db: {
      insert: insertMock,
      select: selectMock,
      update: updateMock,
    },
  };
});

describe("vendor-endpoint repository", () => {
  beforeEach(() => {
    insertedEndpointValues = undefined;
    selectedEndpoints = [];
    updatedEndpoints = [];
  });

  test("createVendorEndpoint stores required fields and returns endpoint", async () => {
    const createdAt = new Date("2024-01-01T00:00:00.000Z");
    const updatedAt = new Date("2024-01-01T00:00:00.000Z");

    selectedEndpoints = [
      {
        id: 10,
        vendorId: 1,
        name: "Official API",
        url: "https://api.example.com",
        apiFormat: "claude",
        isEnabled: true,
        priority: 0,
        latencyMs: null,
        healthCheckEnabled: false,
        healthCheckEndpoint: null,
        healthCheckIntervalSeconds: null,
        healthCheckTimeoutMs: null,
        healthCheckLastCheckedAt: null,
        healthCheckLastStatusCode: null,
        healthCheckErrorMessage: null,
        createdAt,
        updatedAt,
        deletedAt: null,
      },
    ];

    const { createVendorEndpoint } = await import("@/repository/vendor-endpoint");

    const endpoint = await createVendorEndpoint({
      vendorId: 1,
      name: "Official API",
      url: "https://api.example.com",
      apiFormat: "claude",
    });

    expect(insertedEndpointValues).toMatchObject({
      vendorId: 1,
      name: "Official API",
      url: "https://api.example.com",
      apiFormat: "claude",
    });
    expect(endpoint.id).toBe(10);
    expect(endpoint.createdAt).toBeInstanceOf(Date);
  });

  test("updateVendorEndpoint returns null when no row updated", async () => {
    updatedEndpoints = [];

    const { updateVendorEndpoint } = await import("@/repository/vendor-endpoint");
    const result = await updateVendorEndpoint(1, { name: "New Name" });

    expect(result).toBeNull();
  });
});
