// Vendor slug -> LobeHub static SVG icon file resolution.
// vendor-icon-map.json is a verbatim copy of the cch-plus.com official website
// icon map, so icons resolved here match the `icon` fields published in the
// cloud pricing table (served at https://cch-plus.com/model-icons/<file>).
import iconMap from "./vendor-icon-map.json";

export interface VendorIconFileEntry {
  file: string;
  mono?: boolean;
}

const ICONS = iconMap as Record<string, VendorIconFileEntry>;

export const CLOUD_MODEL_ICON_BASE_URL = "https://cch-plus.com/model-icons/";

/** 拼出云端 SVG 图标的完整地址;file 为价格表下发/映射表内的基名 */
export function cloudModelIconUrl(file: string): string {
  return `${CLOUD_MODEL_ICON_BASE_URL}${file}`;
}

/** 精确命中 -> 最长前缀家族(alibaba-coding-plan-cn -> alibaba)回退;都没有返回 null */
export function iconFileForVendor(slug: string): VendorIconFileEntry | null {
  const key = slug.trim().toLowerCase();
  if (!key) return null;
  if (ICONS[key]) return ICONS[key];
  let probe = key;
  while (probe.includes("-")) {
    probe = probe.slice(0, probe.lastIndexOf("-"));
    if (ICONS[probe]) return ICONS[probe];
  }
  return null;
}

/** 任意字符串 -> 确定性强调色(固定明度/彩度,色相走 hash),用于 monogram 兜底 */
export function accentColorOf(seed: string): string {
  let h = 0;
  for (const ch of seed.toLowerCase()) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) | 0;
  }
  const hue = ((h % 360) + 360) % 360;
  return `oklch(0.62 0.13 ${hue})`;
}
