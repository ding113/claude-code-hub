import { afterEach, describe, expect, it, vi } from "vitest";

const { undiciFetchMock } = vi.hoisted(() => ({
  undiciFetchMock: vi.fn(),
}));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetch: undiciFetchMock,
  };
});

import { fetchWithDispatcher } from "@/lib/proxy-agent";

describe("fetchWithDispatcher", () => {
  afterEach(() => {
    undiciFetchMock.mockReset();
  });

  it("forwards url and dispatcher to npm undici fetch", async () => {
    const response = new Response("ok");
    undiciFetchMock.mockResolvedValue(response);
    const dispatcher = { onRequestStart() {} };

    await expect(
      fetchWithDispatcher("https://example.com/v1", {
        method: "POST",
        dispatcher,
      })
    ).resolves.toBe(response);

    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
    expect(undiciFetchMock).toHaveBeenCalledWith("https://example.com/v1", {
      method: "POST",
      dispatcher,
    });
  });
});
