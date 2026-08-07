/**
 * In-process TTL cache. An entry past its TTL is "stale" but is kept around:
 * the degradation path serves stale data with an honest ageSeconds instead
 * of failing when the RPC is down (docs/integration.md 降级矩阵).
 */
export class TtlCache<V> {
  private entries = new Map<string, { value: V; fetchedAt: number }>();

  constructor(private readonly ttlMs: number) {}

  /** Fresh value or undefined (does not return stale entries). */
  getFresh(key: string): { value: V; ageSeconds: number } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const age = Date.now() - entry.fetchedAt;
    if (age > this.ttlMs) return undefined;
    return { value: entry.value, ageSeconds: Math.floor(age / 1000) };
  }

  /** Any value, however old — for serving through an outage. */
  getStale(key: string): { value: V; ageSeconds: number } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    return { value: entry.value, ageSeconds: Math.floor((Date.now() - entry.fetchedAt) / 1000) };
  }

  set(key: string, value: V): void {
    this.entries.set(key, { value, fetchedAt: Date.now() });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
