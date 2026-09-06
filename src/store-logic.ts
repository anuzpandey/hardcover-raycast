import type { HardcoverBook } from "./hardcover";

/** Catalogue records barely change, so a day is conservative. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const HISTORY_LIMIT = 40;

export interface CacheEntry {
  ts: number;
  books: HardcoverBook[];
}

export interface HistoryEntry {
  book: HardcoverBook;
  viewedAt: number;
}

/** "  DUNE " and "dune" are the same search and should share a cache entry. */
export function cacheKey(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Returns the cached books, or null when the entry is missing, stale or
 * unparseable -- callers treat all three the same way, by re-fetching.
 */
export function parseCacheEntry(
  raw: string | undefined,
  now = Date.now(),
): HardcoverBook[] | null {
  if (!raw) {
    return null;
  }

  try {
    const entry = JSON.parse(raw) as CacheEntry;

    if (!Array.isArray(entry.books) || typeof entry.ts !== "number") {
      return null;
    }

    return now - entry.ts > CACHE_TTL_MS ? null : entry.books;
  } catch {
    return null;
  }
}

/** Most recent first, one entry per book, oldest trimmed past the limit. */
export function mergeHistory(
  existing: HistoryEntry[],
  book: HardcoverBook,
  now = Date.now(),
): HistoryEntry[] {
  return [
    { book, viewedAt: now },
    ...existing.filter((entry) => entry.book.slug !== book.slug),
  ].slice(0, HISTORY_LIMIT);
}

export function withoutSlug(
  entries: HistoryEntry[],
  slug: string,
): HistoryEntry[] {
  return entries.filter((entry) => entry.book.slug !== slug);
}

export function parseHistory(raw: string | undefined): HistoryEntry[] {
  if (!raw) {
    return [];
  }

  try {
    const entries = JSON.parse(raw) as HistoryEntry[];

    return Array.isArray(entries)
      ? entries.filter((entry) => entry?.book?.slug)
      : [];
  } catch {
    return [];
  }
}
