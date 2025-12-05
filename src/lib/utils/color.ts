/**
 * Generate a stable color for a provider group string.
 * Returns a CSS hsl() string so it can be used in inline styles.
 */
export function getGroupColor(group?: string | null): string {
  const value = group?.trim();
  if (!value) {
    // Default gray when group is missing
    return "hsl(220, 10%, 40%)";
  }

  // Simple string hash to derive hue (0-359)
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }

  const hue = hash % 360;
  // Use lower lightness (40%) to ensure white text has good contrast
  const saturation = 65;
  const lightness = 40;

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Determine if white or black text should be used on a given background color.
 * Returns 'white' or 'black' based on relative luminance calculation.
 */
export function getContrastTextColor(backgroundColor: string): "white" | "black" {
  // Parse HSL color
  const hslMatch = backgroundColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!hslMatch) {
    return "white"; // Default to white if parsing fails
  }

  const h = parseInt(hslMatch[1], 10);
  const s = parseInt(hslMatch[2], 10) / 100;
  const l = parseInt(hslMatch[3], 10) / 100;

  // Convert HSL to RGB
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  // Convert to 0-255 range
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  // Calculate relative luminance (WCAG formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Use white text on dark backgrounds, black on light
  return luminance > 0.5 ? "black" : "white";
}
