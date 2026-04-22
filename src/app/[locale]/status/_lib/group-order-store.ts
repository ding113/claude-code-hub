const ORDER_KEY = "cch-status-group-order";
const COLLAPSED_KEY = "cch-status-collapsed-groups";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadGroupOrder(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveGroupOrder(slugs: string[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(slugs));
  } catch {
    // ignore quota/privacy errors
  }
}

export function clearGroupOrder(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(ORDER_KEY);
  } catch {
    // ignore
  }
}

export function reconcileOrder(stored: string[], current: string[]): string[] {
  const currentSet = new Set(current);
  const kept = stored.filter((slug) => currentSet.has(slug));
  const keptSet = new Set(kept);
  const appended = current.filter((slug) => !keptSet.has(slug));
  return [...kept, ...appended];
}

export function loadCollapsedSet(): Set<string> {
  if (!isBrowser()) return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function saveCollapsedSet(slugs: Set<string>): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...slugs]));
  } catch {
    // ignore
  }
}
