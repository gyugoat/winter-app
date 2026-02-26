/**
 * WebStore — localStorage-based replacement for @tauri-apps/plugin-store.
 *
 * Mimics the Tauri Store API surface used by the app:
 * - get<T>(key): Promise<T | null>
 * - set(key, value): Promise<void>
 * - save(): Promise<void>
 *
 * Data is namespaced by the store filename (e.g. "sessions.json").
 */

export class WebStore {
  private prefix: string;
  private cache: Map<string, unknown>;

  constructor(filename: string) {
    this.prefix = `winter-store:${filename}:`;
    this.cache = new Map();
    // Load existing data from localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.prefix)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw !== null) {
            this.cache.set(key.slice(this.prefix.length), JSON.parse(raw));
          }
        } catch {
          // skip corrupt entries
        }
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const val = this.cache.get(key);
    return (val as T) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.cache.set(key, value);
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      // localStorage full — best-effort
    }
  }

  async save(): Promise<void> {
    // In our implementation, set() already persists to localStorage.
    // This is a no-op for API compatibility.
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    localStorage.removeItem(this.prefix + key);
  }
}

/**
 * Load a WebStore — drop-in replacement for `load()` from @tauri-apps/plugin-store.
 */
export async function loadWebStore(filename: string): Promise<WebStore> {
  return new WebStore(filename);
}
