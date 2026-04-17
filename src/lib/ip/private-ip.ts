import { isIP } from "node:net";

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

function isIpv4InRange(ip: string, startCidr: string, bits: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const startInt = ipv4ToInt(startCidr);
  if (ipInt === null || startInt === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (startInt & mask);
}

function isPrivateIpv4(ip: string): boolean {
  return (
    isIpv4InRange(ip, "10.0.0.0", 8) ||
    isIpv4InRange(ip, "172.16.0.0", 12) ||
    isIpv4InRange(ip, "192.168.0.0", 16) ||
    isIpv4InRange(ip, "127.0.0.0", 8) ||
    isIpv4InRange(ip, "169.254.0.0", 16) ||
    isIpv4InRange(ip, "100.64.0.0", 10) ||
    ip === "0.0.0.0" ||
    ip === "255.255.255.255"
  );
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded IPv4
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(lower);
  if (mapped) return isPrivateIpv4(mapped[1]);

  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower === "fe80::" || /^fe[89ab]/.test(lower)) return true;
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 (ULA)

  return false;
}

/**
 * Returns true when the IP is considered "private" — RFC 1918, loopback,
 * link-local, carrier-grade NAT, ULA, IPv4-mapped IPv6 of any of those, or
 * the special 0.0.0.0/255.255.255.255 addresses.
 *
 * Invalid input returns false (callers decide what to do with "unknown").
 */
export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return false;
}
