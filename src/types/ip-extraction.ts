export type XffPick = "leftmost" | "rightmost" | { kind: "index"; index: number };

export interface IpHeaderRule {
  name: string;
  pick?: XffPick;
}

export interface IpExtractionConfig {
  headers: IpHeaderRule[];
}

/**
 * Default chain — deliberately conservative.
 *
 * We do NOT trust `cf-connecting-ip` or leftmost `x-forwarded-for` by default:
 * those are client-controlled when no edge proxy strips them, and an attacker
 * could rotate the spoofed value to bypass per-IP lockouts in login /
 * pre-auth rate limiting.
 *
 * Operators fronted by Cloudflare, a CDN, or a trusted reverse proxy that
 * sets its own header should add that header explicitly in system settings:
 *
 *   { headers: [
 *       { name: "cf-connecting-ip" },      // safe only when CF is in front
 *       { name: "x-real-ip" },
 *       { name: "x-forwarded-for", pick: "rightmost" },
 *   ] }
 */
export const DEFAULT_IP_EXTRACTION_CONFIG: IpExtractionConfig = {
  headers: [{ name: "x-real-ip" }, { name: "x-forwarded-for", pick: "rightmost" }],
};
