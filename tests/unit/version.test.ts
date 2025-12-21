import { describe, expect, test } from "vitest";
import { compareVersions, isVersionEqual, isVersionGreater, isVersionLess } from "@/lib/version";

describe("版本比较", () => {
  test("应正确判断是否存在可升级版本（latest > current）", () => {
    expect(compareVersions("v0.3.0", "v0.3.33")).toBe(1);
    expect(compareVersions("v0.3.33", "v0.3.0")).toBe(-1);
    expect(compareVersions("v0.3.33", "v0.3.33")).toBe(0);
  });

  test("应正确处理预发布版本（stable > prerelease）", () => {
    expect(compareVersions("v1.2.3-beta.1", "v1.2.3")).toBe(1);
    expect(compareVersions("v1.2.3", "v1.2.3-beta.1")).toBe(-1);
  });

  test("应正确比较预发布标识（alpha < beta, alpha.1 < alpha.2）", () => {
    expect(compareVersions("v1.2.3-alpha", "v1.2.3-beta")).toBe(1);
    expect(compareVersions("v1.2.3-alpha.1", "v1.2.3-alpha.2")).toBe(1);
    expect(compareVersions("v1.2.3-alpha.2", "v1.2.3-alpha.10")).toBe(1);
  });

  test("应忽略构建元数据（+build）", () => {
    expect(compareVersions("v1.2.3+build.1", "v1.2.3+build.2")).toBe(0);
    expect(compareVersions("v1.2.3+build.2", "v1.2.3+build.1")).toBe(0);
  });

  test("无法解析的版本应 Fail Open（视为相等）", () => {
    expect(compareVersions("dev", "v1.0.0")).toBe(0);
    expect(isVersionLess("dev", "v1.0.0")).toBe(false);
    expect(isVersionGreater("dev", "v1.0.0")).toBe(false);
    expect(isVersionEqual("dev", "v1.0.0")).toBe(true);
  });
});
