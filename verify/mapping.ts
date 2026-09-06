import {
  authorsOf,
  coverUrl,
  downloadCommand,
  toJson,
  genreOf,
  cleanDescription,
  coverFileName,
  coverExtension,
} from "../src/book-json";
import { downloadCover } from "../src/download";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HardcoverBook } from "../src/hardcover";

// The exact payload returned by the live API for "Misery".
const misery = {
  id: 547,
  title: "Misery",
  subtitle: "Halloween edition",
  slug: "misery",
  pages: 384,
  release_date: "1987-01-01",
  rating: 4.1479658792650919,
  ratings_count: 2871,
  users_count: 3345,
  description:
    "Paul Sheldon used to write for a living. Now he''s writing to stay alive.\n\nMisery Chastain is dead. That''s when the car accident happens.",
  image: {
    url: "https://assets.hardcover.app/edition/32041345/d2963373-bde8-4a1c-b336-8d4d0c02ebda.jpg",
    width: 977,
    height: 1500,
    color: "#7c8fbb",
  },
  cached_image: {
    id: 6392341,
    url: "https://assets.hardcover.app/edition/32041345/d2963373-bde8-4a1c-b336-8d4d0c02ebda.jpg",
    color: "#7c8fbb",
    width: 977,
    height: 1500,
    color_name: "Purple",
  },
  cached_tags: null,
  default_cover_edition: {
    isbn_10: "1473662079",
    isbn_13: "9781473662070",
    image: { url: "https://assets.hardcover.app/edition/32041345/d2963373-bde8-4a1c-b336-8d4d0c02ebda.jpg" },
  },
  contributions: [{ author: { name: "Stephen King" } }],
} as unknown as HardcoverBook;

const options = {
  imagePathPrefix: "img/books",
  downloadDir: "public/content-img/books",
  imageFormat: "webp" as const,
  maxHeight: 900,
  quality: 82,
};

console.log("authors      :", authorsOf(misery));
console.log("cover        :", coverUrl(misery)?.slice(0, 60) + "...");
console.log("genre        :", genreOf(misery));
console.log("desc cleaned :", cleanDescription(misery.description)?.slice(0, 62) + "...");
console.log("doubled quotes left:", (cleanDescription(misery.description) ?? "").includes("''"));
console.log("\n--- Copy as JSON output ---");
console.log(toJson(misery, options));
console.log("\n--- Copy Download Command output ---");
console.log(downloadCommand(misery, options));

// The filename written to disk must be the one the JSON's img field names.
const entry = JSON.parse(toJson(misery, options)) as { img: string };
const fileName = coverFileName(misery, options);

console.log("\n--- filename agreement ---");
console.log("extension    :", coverExtension(misery, options));
console.log("file name    :", fileName);
console.log("json img     :", entry.img);
console.log("they agree   :", entry.img.endsWith(fileName));

// Real network: fetch the actual cover, converting on the way in.
const dir = await mkdtemp(join(tmpdir(), "hc-cover-"));
const result = await downloadCover(misery, { ...options, downloadDir: dir });
const bytes = await readFile(result.path);

console.log("\n--- real download (webp) ---");
console.log("saved to      :", result.path.replace(dir, "<tmp>"));
console.log("original      :", Math.round(result.originalBytes / 1024) + " KB");
console.log("written       :", Math.round(result.bytes / 1024) + " KB");
console.log("converted     :", result.converted);
console.log(
  "saving        :",
  Math.round(100 - (result.bytes * 100) / result.originalBytes) + "%",
);
console.log("is webp       :", bytes.subarray(8, 12).toString() === "WEBP");
console.log("json img      :", (JSON.parse(toJson(misery, options)) as { img: string }).img);

const second = await downloadCover(misery, { ...options, downloadDir: dir });
console.log("second replaced:", second.replaced);

// Original format must still work, and must name the file .jpg.
const asJpeg = { ...options, imageFormat: "original" as const, downloadDir: dir };
const plain = await downloadCover(misery, asJpeg);
const plainBytes = await readFile(plain.path);
console.log("\n--- format: original ---");
console.log("saved to      :", plain.path.replace(dir, "<tmp>"));
console.log("is jpeg       :", plainBytes[0] === 0xff && plainBytes[1] === 0xd8);
console.log("json img      :", (JSON.parse(toJson(misery, asJpeg)) as { img: string }).img);

// The shelf form's overrides must land in the JSON.
console.log("\n--- shelf overrides ---");
const withShelf = JSON.parse(
  toJson(misery, options, {
    status: "to_buy",
    reading: "reading",
    rating: 4,
    genre: "Horror",
    notes: "Annie Wilkes is the whole thing.",
  }),
) as Record<string, unknown>;

console.log("status   :", withShelf.status);
console.log("reading  :", withShelf.reading);
console.log("rating   :", withShelf.rating);
console.log("genre    :", withShelf.genre);
console.log("notes    :", withShelf.notes);

const noOverrides = JSON.parse(toJson(misery, options)) as Record<string, unknown>;
console.log("\ndefaults unchanged when nothing is set:");
console.log("status   :", noOverrides.status, "| reading:", noOverrides.reading, "| rating:", noOverrides.rating);

// The community average must never land in `rating`, which is a personal score.
console.log("\n--- public vs personal rating ---");
const asJson = JSON.parse(toJson(misery, options)) as Record<string, unknown>;
console.log("public_rating        :", asJson.public_rating, "(Hardcover average, rounded)");
console.log("public_ratings_count :", asJson.public_ratings_count);
console.log("rating (yours)       :", asJson.rating);

const rated = JSON.parse(
  toJson(misery, options, { rating: 4 }),
) as Record<string, unknown>;
console.log("\nwith your rating set to 4:");
console.log("rating               :", rated.rating);
console.log("public_rating        :", rated.public_rating, "(unchanged)");

console.log(
  "\nkey order matches the portfolio:",
  Object.keys(asJson).join(",").includes("rating,public_rating,public_ratings_count,notes"),
);
