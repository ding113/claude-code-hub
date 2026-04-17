import { describe, expect, test } from "vitest";
import { isPrivateIp } from "./private-ip";

describe("isPrivateIp — IPv4", () => {
  test.each([
    ["10.0.0.1", true],
    ["10.255.255.254", true],
    ["172.16.0.1", true],
    ["172.31.255.254", true],
    ["172.15.0.1", false],
    ["172.32.0.1", false],
    ["192.168.1.1", true],
    ["127.0.0.1", true],
    ["169.254.1.1", true],
    ["100.64.0.1", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["0.0.0.0", true],
    ["255.255.255.255", true],
  ])("%s → %s", (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });
});

describe("isPrivateIp — IPv6", () => {
  test.each([
    ["::1", true],
    ["fe80::1", true],
    ["fc00::1", true],
    ["fd00::1", true],
    ["2001:db8::1", false],
    ["2606:4700:4700::1111", false],
    ["::ffff:10.0.0.1", true],
    ["::ffff:8.8.8.8", false],
  ])("%s → %s", (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });
});

describe("isPrivateIp — edge", () => {
  test("invalid input returns false", () => {
    expect(isPrivateIp("not-an-ip")).toBe(false);
    expect(isPrivateIp("")).toBe(false);
  });
});
