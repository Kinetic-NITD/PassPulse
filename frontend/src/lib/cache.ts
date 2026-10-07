interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

const PREFIX = "passpulse_cache_";
const DEFAULT_TTL = 5 * 60 * 1000;

const memory = new Map<string, CacheEntry<any>>();

export function getCache<T>(key: string, ttl = DEFAULT_TTL): T | null {
    const memEntry = memory.get(key);
    if (memEntry && Date.now() - memEntry.timestamp < ttl) {
        return memEntry.data as T;
    }
    if (typeof window !== "undefined") {
        try {
            const raw = localStorage.getItem(PREFIX + key);
            if (raw) {
                const entry: CacheEntry<T> = JSON.parse(raw);
                if (Date.now() - entry.timestamp < ttl) {
                    memory.set(key, entry);
                    return entry.data;
                }
                localStorage.removeItem(PREFIX + key);
            }
        } catch { }
    }
    return null;
}

export function setCache<T>(key: string, data: T): void {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    memory.set(key, entry);
    if (typeof window !== "undefined") {
        try {
            localStorage.setItem(PREFIX + key, JSON.stringify(entry));
        } catch { }
    }
}

export function invalidateCache(key?: string): void {
    if (key) {
        memory.delete(key);
        if (typeof window !== "undefined") {
            try {
                localStorage.removeItem(PREFIX + key);
            } catch { }
        }
    } else {
        memory.clear();
        if (typeof window !== "undefined") {
            try {
                Object.keys(localStorage)
                    .filter((k) => k.startsWith(PREFIX))
                    .forEach((k) => localStorage.removeItem(k));
            } catch { }
        }
    }
}

export function getCacheAge(key: string): number | null {
    const memEntry = memory.get(key);
    if (memEntry) return Date.now() - memEntry.timestamp;
    if (typeof window !== "undefined") {
        try {
            const raw = localStorage.getItem(PREFIX + key);
            if (raw) return Date.now() - JSON.parse(raw).timestamp;
        } catch { }
    }
    return null;
}