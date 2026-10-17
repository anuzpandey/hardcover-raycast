# Hardcover for Raycast

Search [Hardcover](https://hardcover.app) and copy a book straight into
`app/Contents/Books/books.json`, with its cover art.

## Setup

1. Get a token at **hardcover.app → account settings → Hardcover API → New API Key**.
2. `npm install && npm run dev` — this loads the extension into Raycast.
3. Raycast will ask for the token on first run (or set it in the extension's preferences).

Paste the token **without** the `Bearer` prefix. The extension strips one if
present anyway, because a doubled prefix is reported by the API as
`invalid_token`, which is indistinguishable from a genuinely bad key.

## Preferences

| Preference | Default | What it does |
| --- | --- | --- |
| API Token | — | Your Hardcover personal access token |
| Cover Directory | `public/content-img/books` | Where **Copy Download Command** saves the cover |
| Cover Path Prefix | `img/books` | What goes in the `img` field of the copied JSON |
| Grid Columns | `5` | How many covers per row |

## Actions

| Action | Shortcut | Result |
| --- | --- | --- |
| Set Shelf Details… | `↵` | Pick shelf, reading state, rating, genre and notes, then copy |
| Copy as JSON | — | Copy immediately with defaults (purchased / unread) |
| Show Details | `⌘D` | Full metadata and description |
| Open Cover in Browser | — | The full-resolution cover, ready to save and edit |
| Copy Cover URL | `⌘⇧C` | Just the image URL |
| Copy Download Command | `⌘⇧D` | `curl -L "…" -o public/content-img/books/<slug>.jpg` |
| Save to Hardcover | `⌘↵` | Write the shelf state back to your Hardcover account (form only) |
| Copy, Download Cover and Save to Hardcover | `⌘⇧↵` | All three at once (form only) |
| Open on Hardcover | `⌘O` | The book's page on the website |
| Remove from History | `⌃X` | Forget one book (history view only) |
| Clear History | — | Forget everything |
| Clear Search Cache | — | Force the next search to hit the API |

## Layout

Results are a grid of cover art at a 2:3 aspect ratio, which is what book
jackets actually are. A grid has no detail pane of its own, so the full record
sits behind **Show Details** (`⌘D`) rather than being dropped.

## Shelf details

**Set Shelf Details…** opens a form for the fields Hardcover cannot know — which
shelf the book is on, how far through it you are, your rating, genre and notes —
and copies the JSON with those baked in. It can also copy and download the cover
in one step (`⌘S`).

Shelf and reading state persist between books, since they tend to be added in
runs: several purchases, then several wishlist items.

## Saving back to Hardcover

**Save to Hardcover** (`⌘↵`) sends the same state the JSON records up to your
account, so the shelf in the repo and the shelf on the site cannot drift apart.
`⌘⇧↵` does that plus the clipboard and the cover download in one keystroke.

The two form fields map onto two *independent* things on Hardcover:

| Form field | Hardcover | Why |
| --- | --- | --- |
| Reading → Want to Read | `status_id: 1` | |
| Reading → Reading | `status_id: 2` | |
| Reading → Finished | `status_id: 3` | |
| Shelf → Purchased | a row in the **Owned** list | Hardcover has no owned *status* |
| Shelf → To Buy | no row in that list | |
| Rating | `rating` | Only sent when set, so it never clears one |
| Notes | `private_notes` | Private to the account, not a public review |

Ownership being a list rather than a status is the useful part: a book can be
**Want to Read and owned** at the same time, which is exactly what "bought it,
haven't started it" means. A wishlist book you have not bought is the same
status with no list row. The Owned list is created on first use if the account
has none.

### What it will not do

Reading **progress** is never pushed. That gets logged in the Hardcover app
while you are actually reading, and a form with no page count has nothing
useful to tell it — the portfolio reads progress in the other direction, via
`php artisan books:progress`.

Every push reads the current state first and writes only what actually differs.
Re-saving an unchanged book reports "Already up to date" and sends nothing,
which matters because each write is visible to anyone following the account.

## Cover format

Covers are re-encoded to WebP by default, matching the rest of the site's
content images, and shrunk to 900px tall unless they are already smaller —
never upscaled. On a typical 977x1500 cover that is 230 KB down to 97 KB.

The resize is doing most of that work. WebP at full resolution saved only 12%;
dropping the height to 900px is what got it to 58%.

`sips` cannot write WebP — it reads the format but fails with `Can't write
format: org.webmproject.webp` — so this shells out to `cwebp`
(`brew install webp`). Raycast does not inherit the shell `PATH`, so the binary
is resolved by absolute path. **If `cwebp` is missing the original JPEG is saved
instead**, and the `img` field in the copied JSON says `.jpg` to match, so the
two can never disagree.

## Filenames

The downloaded file and the `img` field in the copied JSON are derived from the
same place, so they always agree — including the extension, which comes from
the cover URL rather than being assumed to be `.jpg`.

Downloading twice overwrites, on purpose: the name comes from the slug, so a
second download is always the same book, and replacing a cover with a better
scan is the main reason to run it again. The toast says whether it saved or
replaced.

## History and caching

Open the command with an empty search bar and you get **Recently Viewed** —
every book you have acted on, newest first, deduped, capped at 40. Acting on a
book is what records it; merely scrolling past one in the grid does not.

Searches are cached on disk for 24 hours, keyed by the normalised query, so
re-running one costs nothing. Only non-empty results are cached, and a stale or
corrupt entry is dropped rather than served.

This matters more than it looks: each search is two requests against a
5,000/day budget, so the cache roughly doubles what a day's worth of searching
buys you.

## How the search works

Two requests per search, on purpose:

1. `search` is Typesense-backed and ranks the way the website does, but returns
   no cover image.
2. `books` has the cover and the ISBNs, but only matches exactly — and `_ilike`
   is disabled server-side.

So search is used purely to turn free text into ranked slugs, then those slugs
are looked up with `_in` for the real records. The original ranking is restored
afterwards, since the lookup only knows popularity.

Note that Hardcover's rate limit allows only **one `search` query per request**,
which is why the two cannot be combined.

## Fields that are deliberately left blank

- `rating` — this is *your* score out of 5. Hardcover's community average is
  emitted separately as `public_rating`, with `public_ratings_count` alongside
  it, so the two can never be confused for one another.
- `genre` — read from the undocumented `cached_tags` blob when its shape is
  recognisable, otherwise left null to fill in by hand.
- `publisher` — lives on the edition, and rarely the edition you own.
- `status` / `reading` — default to `purchased` / `unread`; change per book.

Descriptions are cleaned on the way out: Hardcover stores them with doubled
single quotes (`he''s writing`), which would otherwise land in the JSON.

## Verifying the mapping

`npm run verify` runs a real API payload through the mapping and prints the
resulting JSON, then exercises the cache TTL and history rules — 17 checks in
all. Neither needs a token or Raycast, because the logic lives in
`book-json.ts` and `store-logic.ts`, which are free of Raycast imports.
