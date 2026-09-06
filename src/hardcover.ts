import { getPreferenceValues } from "@raycast/api";
import { homedir } from "node:os";
import { join } from "node:path";
import { readCache, writeCache } from "./store";

const ENDPOINT = "https://api.hardcover.app/v1/graphql";

export interface HardcoverImage {
  url: string | null;
  width?: number | null;
  height?: number | null;
  color?: string | null;
}

export interface HardcoverBook {
  id: number;
  title: string;
  subtitle: string | null;
  slug: string;
  pages: number | null;
  release_date: string | null;
  rating: number | null;
  users_count: number | null;
  description: string | null;
  image: HardcoverImage | null;
  cached_image: (HardcoverImage & { color_name?: string }) | null;
  cached_tags: unknown;
  default_cover_edition: {
    isbn_10: string | null;
    isbn_13: string | null;
    image: HardcoverImage | null;
  } | null;
  contributions: { author: { name: string } | null }[];
}

interface Preferences {
  apiToken: string;
  downloadDir?: string;
  imagePathPrefix?: string;
  gridColumns?: string;
  imageFormat?: string;
  maxHeight?: string;
  quality?: string;
}

export interface Options {
  apiToken: string;
  downloadDir: string;
  imagePathPrefix: string;
  gridColumns: number;
  imageFormat: "webp" | "original";
  maxHeight: number;
  quality: number;
}

export function preferences(): Options {
  const prefs = getPreferenceValues<Preferences>();

  return {
    apiToken: prefs.apiToken.replace(/^Bearer\s+/i, "").trim(),
    // A directory preference hands back an absolute path; without one there
    // is no sensible relative root, so fall back to the obvious place.
    downloadDir: prefs.downloadDir?.trim() || join(homedir(), "Downloads"),
    imagePathPrefix:
      prefs.imagePathPrefix?.trim().replace(/\/$/, "") || "img/books",
    gridColumns: Number.parseInt(prefs.gridColumns ?? "5", 10) || 5,
    imageFormat: prefs.imageFormat === "original" ? "original" : "webp",
    // 0 means "don't resize"; Infinity makes every height comparison false.
    maxHeight:
      Number.parseInt(prefs.maxHeight ?? "900", 10) || Number.POSITIVE_INFINITY,
    quality: Number.parseInt(prefs.quality ?? "82", 10) || 82,
  };
}

async function gql<T>(query: string, signal?: AbortSignal): Promise<T> {
  const { apiToken } = preferences();

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The token is stored without the prefix so it can never end up doubled,
      // which the API reports as an indistinguishable "invalid_token".
      Authorization: `Bearer ${apiToken}`,
      "User-Agent": "raycast-hardcover (personal use)",
    },
    body: JSON.stringify({ query }),
    signal,
  });

  const payload = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
    error?: string;
    error_description?: string;
  };

  if (!response.ok || payload.errors || payload.error) {
    const message =
      payload.errors?.[0]?.message ??
      payload.error_description ??
      payload.error ??
      `Request failed with ${response.status}`;

    if (response.status === 401) {
      throw new Error(
        "Token rejected. Check the API token in this extension's preferences.",
      );
    }

    throw new Error(message);
  }

  if (!payload.data) {
    throw new Error("The API returned no data.");
  }

  return payload.data;
}

const escape = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * Two steps on purpose.
 *
 * `search` is Typesense-backed and ranks the way the website does, but returns
 * no cover image. `books` has the cover and the ISBNs but only matches exactly,
 * and `_ilike` is disabled server-side. So search is used purely to turn free
 * text into ranked slugs, then those slugs are looked up for the real records.
 */
export async function searchBooks(
  query: string,
  signal?: AbortSignal,
): Promise<HardcoverBook[]> {
  const term = query.trim();

  if (term.length < 2) {
    return [];
  }

  // Every search costs two requests against a 5,000/day budget, so a repeated
  // query is served from disk instead.
  const cached = readCache(term);

  if (cached) {
    return cached;
  }

  const searchData = await gql<{ search: { results: unknown } }>(
    `query { search(query: "${escape(term)}", query_type: "Book", per_page: 10, page: 1) { results } }`,
    signal,
  );

  const slugs = extractSlugs(searchData.search?.results);

  if (slugs.length === 0) {
    return [];
  }

  const list = slugs.map((slug) => `"${escape(slug)}"`).join(", ");

  const bookData = await gql<{ books: HardcoverBook[] }>(
    `query { books(where: {slug: {_in: [${list}]}}, order_by: {users_count: desc}) {
      id title subtitle slug pages release_date rating users_count description
      image { url width height color }
      cached_image
      cached_tags
      default_cover_edition { isbn_10 isbn_13 image { url } }
      contributions { author { name } }
    } }`,
    signal,
  );

  // Restore the ranking search gave us; the lookup only knows popularity.
  const order = new Map(slugs.map((slug, index) => [slug, index]));

  const ranked = [...(bookData.books ?? [])].sort(
    (a, b) => (order.get(a.slug) ?? 999) - (order.get(b.slug) ?? 999),
  );

  writeCache(term, ranked);

  return ranked;
}

/**
 * `results` is a raw Typesense payload rather than a typed GraphQL object, so
 * this walks it defensively instead of trusting a shape.
 */
function extractSlugs(results: unknown): string[] {
  const hits = (results as { hits?: { document?: { slug?: string } }[] })?.hits;

  if (!Array.isArray(hits)) {
    return [];
  }

  return hits
    .map((hit) => hit?.document?.slug)
    .filter(
      (slug): slug is string => typeof slug === "string" && slug.length > 0,
    );
}
