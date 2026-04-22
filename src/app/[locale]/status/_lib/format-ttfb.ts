export function formatTtfb(ms: number | null): string {
  if (ms === null) return "—";
  if (ms >= 10000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${ms} ms`;
}
