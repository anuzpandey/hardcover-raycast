import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coverFileName, coverUrl, type EntryOptions } from "./book-json";
import { toWebp, webpAvailable } from "./convert";
import type { HardcoverBook } from "./hardcover";
import { setWhereFrom } from "./where-from";

export interface DownloadResult {
  path: string;
  bytes: number;
  originalBytes: number;
  replaced: boolean;
  converted: boolean;
  /** Whether Finder's "Where from" was set; see setWhereFrom. */
  tagged: boolean;
}

/**
 * Saves the cover under the same filename the JSON entry points at, so the
 * `img` field is correct the moment both are in place.
 *
 * Overwrites deliberately: the name is derived from the slug, so a second
 * download is always the same book, and replacing a cover with a better scan
 * is the main reason to run this twice. The caller is told which happened.
 */
export async function downloadCover(
  book: HardcoverBook,
  options: EntryOptions & { maxHeight: number; quality: number },
): Promise<DownloadResult> {
  const url = coverUrl(book);

  if (!url) {
    throw new Error("This book has no cover to download.");
  }

  const response = await fetch(url, {
    headers: { "User-Agent": "raycast-hardcover (personal use)" },
  });

  if (!response.ok) {
    throw new Error(`Cover download failed with ${response.status}.`);
  }

  const original = Buffer.from(await response.arrayBuffer());

  // Hardcover serves a tiny placeholder rather than a 404 for missing art.
  if (original.byteLength < 1024) {
    throw new Error("The cover came back empty.");
  }

  // Uint8Array rather than Buffer: readFile and Buffer.from disagree on the
  // generic parameter, and writeFile accepts either.
  let buffer: Uint8Array = original;
  let converted = false;

  // A failed conversion must not lose the download: fall back to the original
  // bytes, which coverFileName already accounts for when naming the file.
  if (options.imageFormat === "webp" && webpAvailable()) {
    try {
      buffer = await toWebp(original, {
        maxHeight: options.maxHeight,
        quality: options.quality,
      });
      converted = true;
    } catch {
      buffer = original;
      converted = false;
    }
  }

  await mkdir(options.downloadDir, { recursive: true });

  const path = join(options.downloadDir, coverFileName(book, options));
  const replaced = await exists(path);

  await writeFile(path, buffer);

  // Best effort: the cover is already saved, and a missing attribute only
  // means a folder automation will not recognise it.
  let tagged = true;

  try {
    await setWhereFrom(path, [url, `https://hardcover.app/books/${book.slug}`]);
  } catch {
    tagged = false;
  }

  return {
    path,
    bytes: buffer.byteLength,
    originalBytes: original.byteLength,
    replaced,
    converted,
    tagged,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);

    return true;
  } catch {
    return false;
  }
}
