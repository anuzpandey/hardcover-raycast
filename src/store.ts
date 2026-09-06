import { Cache, LocalStorage } from "@raycast/api";
import type { HardcoverBook } from "./hardcover";
import {
  cacheKey,
  mergeHistory,
  parseCacheEntry,
  parseHistory,
  withoutSlug,
  type CacheEntry,
  type HistoryEntry,
} from "./store-logic";

/**
 * Two different jobs, so two different stores.
 *
 * Search results go in Cache: they are disposable and benefit from LRU
 * eviction. History goes in LocalStorage, which is not evictable -- a book you
 * looked at last week should still be there.
 *
 * All the rules live in store-logic.ts; this file is only the I/O around them.
 */
// Namespace bumped when the query changes shape, so entries cached before a
// new field existed are not served back missing it.
const cache = new Cache({ namespace: "search-v2" });

const HISTORY_KEY = "history";

export type { HistoryEntry };

export function readCache(query: string): HardcoverBook[] | null {
  const key = cacheKey(query);
  const books = parseCacheEntry(cache.get(key));

  if (books === null) {
    cache.remove(key);
  }

  return books;
}

export function writeCache(query: string, books: HardcoverBook[]): void {
  if (books.length === 0) {
    return;
  }

  cache.set(
    cacheKey(query),
    JSON.stringify({ ts: Date.now(), books } satisfies CacheEntry),
  );
}

export function clearCache(): void {
  cache.clear();
}

export async function readHistory(): Promise<HistoryEntry[]> {
  return parseHistory(await LocalStorage.getItem<string>(HISTORY_KEY));
}

export async function recordVisit(book: HardcoverBook): Promise<void> {
  const next = mergeHistory(await readHistory(), book);

  await LocalStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

export async function forgetVisit(slug: string): Promise<void> {
  const remaining = withoutSlug(await readHistory(), slug);

  await LocalStorage.setItem(HISTORY_KEY, JSON.stringify(remaining));
}

export async function clearHistory(): Promise<void> {
  await LocalStorage.removeItem(HISTORY_KEY);
}

const DEFAULTS_KEY = "entry-defaults";

export interface EntryDefaults {
  status: string;
  reading: string;
}

/**
 * Books tend to be added in runs -- several purchases at once, then several
 * wishlist items -- so the form opens on whatever was chosen last rather than
 * resetting every time.
 */
export async function readEntryDefaults(): Promise<EntryDefaults> {
  const raw = await LocalStorage.getItem<string>(DEFAULTS_KEY);

  if (!raw) {
    return { status: "purchased", reading: "unread" };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<EntryDefaults>;

    return {
      status: parsed.status ?? "purchased",
      reading: parsed.reading ?? "unread",
    };
  } catch {
    return { status: "purchased", reading: "unread" };
  }
}

export async function writeEntryDefaults(
  defaults: EntryDefaults,
): Promise<void> {
  await LocalStorage.setItem(DEFAULTS_KEY, JSON.stringify(defaults));
}
