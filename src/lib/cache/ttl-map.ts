export class TTLMap<K, V> {
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly store = new Map<K, { value: V; expiresAt: number }>();

  constructor(opts: { ttlMs: number; maxSize: number }) {
    this.ttlMs = opts.ttlMs;
    this.maxSize = opts.maxSize;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    // LRU bump: delete and re-insert to move to end of iteration order
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Delete first so re-insert goes to end (LRU order)
    this.store.delete(key);

    if (this.store.size >= this.maxSize) {
      this.evict();
    }

    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  has(key: K): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  clear(): void {
    this.store.clear();
  }

  purgeExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (v.expiresAt <= now) {
        this.store.delete(k);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }

  private evict(): void {
    const now = Date.now();

    // First pass: remove expired entries
    for (const [k, v] of this.store) {
      if (v.expiresAt <= now) {
        this.store.delete(k);
      }
    }

    // If still at capacity, evict oldest 10%
    if (this.store.size >= this.maxSize) {
      const evictCount = Math.max(1, Math.ceil(this.maxSize * 0.1));
      let remaining = evictCount;

      for (const k of this.store.keys()) {
        this.store.delete(k);
        remaining -= 1;
        if (remaining <= 0) break;
      }
    }
  }
}
