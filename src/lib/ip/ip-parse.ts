function isValidIpv4Octet(segment: string): boolean {
  if (!/^\d+$/.test(segment)) return false;
  const value = Number(segment);
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

export function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every(isValidIpv4Octet);
}

function isValidIpv6Hextet(segment: string): boolean {
  return /^[0-9a-f]{1,4}$/i.test(segment);
}

function isValidIpv6Section(section: string): boolean {
  if (!section) return true;
  return section.split(":").every(isValidIpv6Hextet);
}

export function isValidIpv6(ip: string): boolean {
  if (!ip || ip.includes(":::")) return false;

  const mappedIpv4Match = /^(.*::ffff:)(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mappedIpv4Match) {
    const prefix = mappedIpv4Match[1].slice(0, -5);
    return isValidIpv4(mappedIpv4Match[2]) && isValidIpv6(prefix);
  }

  const parts = ip.split("::");
  if (parts.length > 2) return false;

  if (parts.length === 2) {
    const [left, right] = parts;
    const leftCount = left ? left.split(":").length : 0;
    const rightCount = right ? right.split(":").length : 0;
    if (leftCount + rightCount >= 8) return false;
    return isValidIpv6Section(left) && isValidIpv6Section(right);
  }

  const segments = ip.split(":");
  if (segments.length !== 8) return false;
  return segments.every(isValidIpv6Hextet);
}

export function getIpVersion(ip: string): 0 | 4 | 6 {
  if (isValidIpv4(ip)) return 4;
  if (isValidIpv6(ip)) return 6;
  return 0;
}

export function isValidIp(ip: string): boolean {
  return getIpVersion(ip) !== 0;
}
