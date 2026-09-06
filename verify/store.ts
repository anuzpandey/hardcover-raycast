import {
  CACHE_TTL_MS,
  HISTORY_LIMIT,
  cacheKey,
  mergeHistory,
  parseCacheEntry,
  parseHistory,
  withoutSlug,
  type HistoryEntry,
} from "../src/store-logic";
import type { HardcoverBook } from "../src/hardcover";

const book = (slug: string) => ({ slug, title: slug }) as unknown as HardcoverBook;
const entry = (books: HardcoverBook[], ts: number) => JSON.stringify({ ts, books });

let failures = 0;
const check = (label: string, pass: boolean) => {
  if (!pass) failures++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
};

const now = Date.now();

console.log("cache");
check("normalises key casing and spacing", cacheKey("  DUNE ") === "dune");
check("missing entry misses", parseCacheEntry(undefined) === null);
check("fresh entry hits", parseCacheEntry(entry([book("dune")], now), now)?.length === 1);
check(
  "entry just inside the TTL still hits",
  parseCacheEntry(entry([book("dune")], now - CACHE_TTL_MS + 1000), now) !== null,
);
check(
  "entry past the TTL misses",
  parseCacheEntry(entry([book("dune")], now - CACHE_TTL_MS - 1000), now) === null,
);
check("malformed JSON misses instead of throwing", parseCacheEntry("{not json", now) === null);
check("wrong shape misses", parseCacheEntry(JSON.stringify({ nope: true }), now) === null);

console.log("history");
check("empty storage yields no history", parseHistory(undefined).length === 0);
check("malformed history yields none", parseHistory("[[[").length === 0);

let history: HistoryEntry[] = [];
history = mergeHistory(history, book("dune"), now);
history = mergeHistory(history, book("misery"), now + 1);
check("records each book", history.length === 2);
check("most recent first", history[0].book.slug === "misery");

history = mergeHistory(history, book("dune"), now + 2);
check("revisiting dedupes rather than duplicating", history.length === 2);
check("revisiting moves it to the front", history[0].book.slug === "dune");

let big: HistoryEntry[] = [];
for (let i = 0; i < HISTORY_LIMIT + 15; i++) {
  big = mergeHistory(big, book(`book-${i}`), now + i);
}
check(`caps at ${HISTORY_LIMIT}`, big.length === HISTORY_LIMIT);
check("keeps the newest when capping", big[0].book.slug === `book-${HISTORY_LIMIT + 14}`);

check("forget removes one", withoutSlug(history, "dune").map((e) => e.book.slug).join() === "misery");
check("forgetting an unknown slug is a no-op", withoutSlug(history, "nope").length === 2);

console.log(failures === 0 ? "\nall store checks passed" : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
