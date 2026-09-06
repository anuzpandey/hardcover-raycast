import type { HardcoverBook } from "./hardcover";
import { webpAvailable } from "./convert";

export interface EntryOptions {
  imagePathPrefix: string;
  downloadDir: string;
  imageFormat: "webp" | "original";
}

/** One entry of app/Contents/Books/books.json. */
export interface BookEntry {
  slug: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  genre: string | null;
  year: number | null;
  pages: number | null;
  publisher: string | null;
  isbn: string | null;
  status: "purchased" | "to_buy";
  reading: "unread" | "reading" | "finished";
  /** Your own score out of 5. */
  rating: number | null;
  /** Hardcover's community average, and how many ratings it is drawn from. */
  public_rating: number | null;
  public_ratings_count: number | null;
  notes: string | null;
  description: string | null;
  img: string;
}

export function coverUrl(book: HardcoverBook): string | null {
  return (
    book.image?.url ??
    book.cached_image?.url ??
    book.default_cover_edition?.image?.url ??
    null
  );
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);

/**
 * The extension the cover actually has, so the file written to disk and the
 * `img` field in the JSON can never disagree about it.
 */
export function coverExtension(
  book: HardcoverBook,
  options: EntryOptions,
): string {
  // Follows what will actually be written, fallback included: claiming .webp in
  // the JSON while saving a .jpg because cwebp is missing is exactly the drift
  // this is meant to prevent.
  if (options.imageFormat === "webp" && webpAvailable()) {
    return "webp";
  }

  const url = coverUrl(book);

  if (!url) {
    return "jpg";
  }

  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";

    return IMAGE_EXTENSIONS.has(ext) ? (ext === "jpeg" ? "jpg" : ext) : "jpg";
  } catch {
    return "jpg";
  }
}

/** The one filename both the download and the JSON refer to. */
export function coverFileName(
  book: HardcoverBook,
  options: EntryOptions,
): string {
  return `${book.slug}.${coverExtension(book, options)}`;
}

export function authorsOf(book: HardcoverBook): string[] {
  return book.contributions
    .map((contribution) => contribution.author?.name)
    .filter((name): name is string => Boolean(name))
    .filter((name, index, all) => all.indexOf(name) === index);
}

export function yearOf(book: HardcoverBook): number | null {
  if (!book.release_date) {
    return null;
  }

  const year = Number.parseInt(book.release_date.slice(0, 4), 10);

  return Number.isFinite(year) ? year : null;
}

/**
 * Hardcover descriptions arrive with doubled single quotes -- "he''s writing"
 * -- which looks like SQL escaping that leaked into the stored text. Left
 * alone it ends up in the JSON and then on the page.
 */
export function cleanDescription(description: string | null): string | null {
  if (!description) {
    return null;
  }

  const cleaned = description.replace(/''/g, "'").trim();

  return cleaned.length > 0 ? cleaned : null;
}

/**
 * cached_tags is untyped jsonb whose shape is not documented, so this probes
 * the likely arrangements and gives up quietly rather than guessing wrong.
 */
export function genreOf(book: HardcoverBook): string | null {
  const tags = book.cached_tags as Record<string, unknown> | null | undefined;

  if (!tags || typeof tags !== "object") {
    return null;
  }

  const bucket = tags["Genre"] ?? tags["genre"] ?? tags["genres"];

  if (!Array.isArray(bucket) || bucket.length === 0) {
    return null;
  }

  const first = bucket[0];

  if (typeof first === "string") {
    return first;
  }

  if (first && typeof first === "object") {
    const named = first as Record<string, unknown>;
    const value = named.tag ?? named.name ?? named.title;

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

/** What the shelf form can override before the JSON is copied. */
export interface EntryOverrides {
  status?: BookEntry["status"];
  reading?: BookEntry["reading"];
  rating?: number | null;
  notes?: string | null;
  genre?: string | null;
}

export function toEntry(
  book: HardcoverBook,
  options: EntryOptions,
  overrides: EntryOverrides = {},
): BookEntry {
  return {
    slug: book.slug,
    title: book.title,
    subtitle: book.subtitle,
    authors: authorsOf(book),
    genre: overrides.genre ?? genreOf(book),
    year: yearOf(book),
    pages: book.pages,
    // Not in the query: publisher lives on the edition and is rarely the one
    // you actually own, so it is left to be filled in by hand.
    publisher: null,
    isbn:
      book.default_cover_edition?.isbn_13 ??
      book.default_cover_edition?.isbn_10 ??
      null,
    status: overrides.status ?? "purchased",
    reading: overrides.reading ?? "unread",
    // Deliberately not Hardcover's average: this field is your own score.
    rating: overrides.rating ?? null,
    // Hardcover's own numbers, kept well away from `rating` above: conflating
    // a 4.15 community average with a personal 4/5 would quietly destroy the
    // latter. Rounded because the raw value carries fifteen decimal places and
    // would make every re-run of the shelf a noisy diff.
    public_rating:
      book.rating === null ? null : Math.round(book.rating * 100) / 100,
    public_ratings_count: book.ratings_count ?? null,
    notes: overrides.notes ?? null,
    description: cleanDescription(book.description),
    img: `${options.imagePathPrefix}/${coverFileName(book, options)}`,
  };
}

export function toJson(
  book: HardcoverBook,
  options: EntryOptions,
  overrides: EntryOverrides = {},
): string {
  return JSON.stringify(toEntry(book, options, overrides), null, 2);
}

/** A ready-to-paste curl that drops the cover straight into the repo. */
export function downloadCommand(
  book: HardcoverBook,
  options: EntryOptions,
): string | null {
  const url = coverUrl(book);

  if (!url) {
    return null;
  }

  return `curl -L "${url}" -o "${options.downloadDir}/${coverFileName(book, options)}"`;
}
