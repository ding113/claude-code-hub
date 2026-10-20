import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { buildBalanceCacheKey } = await import("@/lib/provider-balance/cache");

const base = {
  id: 3,
  url: "https://relay.example.com",
  key: "sk-test",
  proxyUrl: null,
  newApiAccessToken: null,
  newApiUserId: null,
};

describe("buildBalanceCacheKey", () => {
  it("相同配置得到相同的键，键以供应商 ID 开头", () => {
    expect(buildBalanceCacheKey(base)).toBe(buildBalanceCacheKey({ ...base }));
    expect(buildBalanceCacheKey(base).startsWith("3:")).toBe(true);
  });

  it("配置、更换或清除系统访问令牌后旧快照失效", () => {
    const withToken = buildBalanceCacheKey({ ...base, newApiAccessToken: "pat-a" });

    expect(withToken).not.toBe(buildBalanceCacheKey(base));
    expect(withToken).not.toBe(buildBalanceCacheKey({ ...base, newApiAccessToken: "pat-b" }));
  });

  it("修改用户 ID 后旧快照失效", () => {
    const withUser = buildBalanceCacheKey({ ...base, newApiAccessToken: "pat-a", newApiUserId: 7 });

    expect(withUser).not.toBe(
      buildBalanceCacheKey({ ...base, newApiAccessToken: "pat-a", newApiUserId: 8 })
    );
    expect(withUser).not.toBe(buildBalanceCacheKey({ ...base, newApiAccessToken: "pat-a" }));
  });

  it("密钥、地址与代理改变后旧快照失效", () => {
    const original = buildBalanceCacheKey(base);

    expect(buildBalanceCacheKey({ ...base, key: "sk-other" })).not.toBe(original);
    expect(buildBalanceCacheKey({ ...base, url: "https://other.example.com" })).not.toBe(original);
    expect(buildBalanceCacheKey({ ...base, proxyUrl: "http://proxy:8080" })).not.toBe(original);
  });
});
