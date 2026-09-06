import {
  Action,
  ActionPanel,
  Detail,
  Grid,
  Icon,
  Keyboard,
  showToast,
  Toast,
  confirmAlert,
  Alert,
  open,
  showInFinder,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import {
  authorsOf,
  coverUrl,
  downloadCommand,
  toJson,
  yearOf,
} from "./book-json";
import { downloadCover } from "./download";
import { ShelfForm } from "./shelf-form";
import {
  HardcoverBook,
  preferences,
  searchBooks,
  type Options,
} from "./hardcover";
import {
  clearCache,
  clearHistory,
  forgetVisit,
  readEntryDefaults,
  readHistory,
  recordVisit,
  type EntryDefaults,
} from "./store";

const MIN_QUERY = 2;

export default function Command() {
  const [query, setQuery] = useState("");
  const options = preferences();
  const searching = query.trim().length >= MIN_QUERY;

  const { data, isLoading } = usePromise(
    async (term: string, signal?: AbortSignal) =>
      term.trim().length >= MIN_QUERY ? searchBooks(term, signal) : [],
    [query],
    {
      onError(error) {
        showToast({
          style: Toast.Style.Failure,
          title: "Hardcover search failed",
          message: error.message,
        });
      },
    },
  );

  // History is its own promise so it can be revalidated after a visit without
  // disturbing the search results on screen.
  const { data: history, revalidate: refreshHistory } = usePromise(
    readHistory,
    [],
  );
  const { data: entryDefaults } = usePromise(readEntryDefaults, []);

  const books = searching
    ? (data ?? [])
    : (history ?? []).map((entry) => entry.book);

  return (
    <Grid
      isLoading={isLoading}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Search Hardcover for a book…"
      throttle
      columns={options.gridColumns}
      aspectRatio="2/3"
      fit={Grid.Fit.Fill}
    >
      {books.length === 0 ? (
        <Grid.EmptyView
          icon={Icon.Book}
          title={searching ? "No books found" : "Search Hardcover"}
          description={
            searching
              ? "Try including the author's name."
              : "Type at least two characters. Books you open show up here."
          }
        />
      ) : (
        <Grid.Section
          title={searching ? "Results" : "Recently Viewed"}
          subtitle={String(books.length)}
        >
          {books.map((book) => (
            <BookTile
              key={book.slug}
              book={book}
              options={options}
              inHistory={!searching}
              onVisit={refreshHistory}
              defaults={
                entryDefaults ?? { status: "purchased", reading: "unread" }
              }
            />
          ))}
        </Grid.Section>
      )}
    </Grid>
  );
}

function BookTile({
  book,
  options,
  inHistory,
  onVisit,
  defaults,
}: {
  book: HardcoverBook;
  options: Options;
  inHistory: boolean;
  onVisit: () => void;
  defaults: EntryDefaults;
}) {
  const authors = authorsOf(book);
  const year = yearOf(book);
  const cover = coverUrl(book);

  return (
    <Grid.Item
      content={cover ? { source: cover } : { source: Icon.Book }}
      title={book.title}
      subtitle={[authors.join(", ") || "Unknown author", year]
        .filter(Boolean)
        .join(" · ")}
      actions={
        <BookActions
          book={book}
          options={options}
          showDetail
          inHistory={inHistory}
          onVisit={onVisit}
          defaults={defaults}
        />
      }
    />
  );
}

/** Shared so the grid tile and the pushed detail view offer the same things. */
function BookActions({
  book,
  options,
  showDetail = false,
  inHistory = false,
  onVisit,
  defaults,
}: {
  book: HardcoverBook;
  options: Options;
  showDetail?: boolean;
  inHistory?: boolean;
  onVisit?: () => void;
  defaults?: EntryDefaults;
}) {
  const cover = coverUrl(book);
  const download = downloadCommand(book, options);

  // Acting on a book is the signal that it is worth remembering -- merely
  // scrolling past it in a grid is not.
  const remember = async () => {
    await recordVisit(book);
    onVisit?.();
  };

  return (
    <ActionPanel>
      <ActionPanel.Section>
        <Action.Push
          title="Set Shelf Details…"
          icon={Icon.Pencil}
          target={
            <ShelfForm
              book={book}
              options={options}
              defaults={defaults ?? { status: "purchased", reading: "unread" }}
              onRecorded={remember}
            />
          }
        />
        <Action.CopyToClipboard
          title="Copy as JSON"
          icon={Icon.Clipboard}
          content={toJson(book, options)}
          onCopy={remember}
        />
        {cover ? (
          <Action
            title="Download Cover"
            icon={Icon.Download}
            shortcut={Keyboard.Shortcut.Common.Save}
            onAction={async () => {
              const toast = await showToast({
                style: Toast.Style.Animated,
                title: "Downloading cover…",
              });

              try {
                const result = await downloadCover(book, options);
                await remember();

                const kb = Math.round(result.bytes / 1024);
                const saved = Math.round(
                  100 -
                    (result.bytes * 100) / Math.max(result.originalBytes, 1),
                );

                toast.style = Toast.Style.Success;
                toast.title = result.replaced
                  ? "Cover replaced"
                  : "Cover saved";
                toast.message = result.converted
                  ? `${result.path} · ${kb} KB (webp, −${saved}%)`
                  : `${result.path} · ${kb} KB`;
                toast.primaryAction = {
                  title: "Show in Finder",
                  onAction: () => showInFinder(result.path),
                };
                toast.secondaryAction = {
                  title: "Open Image",
                  onAction: () => open(result.path),
                };
              } catch (error) {
                toast.style = Toast.Style.Failure;
                toast.title = "Download failed";
                toast.message =
                  error instanceof Error ? error.message : String(error);
              }
            }}
          />
        ) : null}
        {cover ? (
          <Action.OpenInBrowser
            title="Open Cover in Browser"
            icon={Icon.Image}
            url={cover}
            onOpen={remember}
          />
        ) : null}
        {showDetail ? (
          <Action.Push
            title="Show Details"
            icon={Icon.Sidebar}
            target={<BookDetailView book={book} options={options} />}
            shortcut={{ modifiers: ["cmd"], key: "d" }}
            onPush={remember}
          />
        ) : null}
      </ActionPanel.Section>

      <ActionPanel.Section>
        {cover ? (
          <Action.CopyToClipboard
            title="Copy Cover URL"
            icon={Icon.Link}
            content={cover}
            shortcut={Keyboard.Shortcut.Common.Copy}
            onCopy={remember}
          />
        ) : null}
        {download ? (
          <Action.CopyToClipboard
            title="Copy Download Command"
            icon={Icon.Terminal}
            content={download}
            shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
            onCopy={remember}
          />
        ) : null}
        <Action.OpenInBrowser
          title="Open on Hardcover"
          icon={Icon.Globe}
          url={`https://hardcover.app/books/${book.slug}`}
          shortcut={Keyboard.Shortcut.Common.Open}
          onOpen={remember}
        />
      </ActionPanel.Section>

      <ActionPanel.Section title="Maintenance">
        {inHistory ? (
          <Action
            title="Remove from History"
            icon={Icon.XMarkCircle}
            style={Action.Style.Destructive}
            shortcut={Keyboard.Shortcut.Common.Remove}
            onAction={async () => {
              await forgetVisit(book.slug);
              onVisit?.();
              await showToast({
                style: Toast.Style.Success,
                title: "Removed from history",
              });
            }}
          />
        ) : null}
        <Action
          title="Clear History"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          onAction={async () => {
            const confirmed = await confirmAlert({
              title: "Clear history?",
              message: "Every book you have opened will be forgotten.",
              primaryAction: {
                title: "Clear",
                style: Alert.ActionStyle.Destructive,
              },
            });

            if (confirmed) {
              await clearHistory();
              onVisit?.();
              await showToast({
                style: Toast.Style.Success,
                title: "History cleared",
              });
            }
          }}
        />
        <Action
          title="Clear Search Cache"
          icon={Icon.ArrowClockwise}
          onAction={async () => {
            clearCache();
            await showToast({
              style: Toast.Style.Success,
              title: "Cache cleared",
              message: "The next search will hit the API again.",
            });
          }}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );
}

/**
 * The grid has no detail pane of its own, so the full record lives behind an
 * action instead of being lost.
 */
function BookDetailView({
  book,
  options,
}: {
  book: HardcoverBook;
  options: Options;
}) {
  const authors = authorsOf(book);
  const year = yearOf(book);
  const cover = coverUrl(book);
  const isbn =
    book.default_cover_edition?.isbn_13 ?? book.default_cover_edition?.isbn_10;

  const markdown = [
    cover ? `![${book.title}](${cover}?raycast-height=340)` : "",
    `# ${book.title}`,
    book.subtitle ? `*${book.subtitle}*` : "",
    book.description ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <Detail
      markdown={markdown}
      navigationTitle={book.title}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label
            title="Authors"
            text={authors.join(", ") || "—"}
          />
          <Detail.Metadata.Label
            title="Published"
            text={year ? String(year) : "—"}
          />
          <Detail.Metadata.Label
            title="Pages"
            text={book.pages ? String(book.pages) : "—"}
          />
          <Detail.Metadata.Label title="ISBN" text={isbn ?? "—"} />
          <Detail.Metadata.Label
            title="Hardcover Rating"
            text={
              book.rating
                ? `${book.rating.toFixed(2)} · ${book.users_count ?? 0} readers`
                : "—"
            }
          />
          <Detail.Metadata.Label
            title="Cover"
            text={
              book.image?.width
                ? `${book.image.width}×${book.image.height}`
                : "—"
            }
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Slug" text={book.slug} />
        </Detail.Metadata>
      }
      actions={<BookActions book={book} options={options} />}
    />
  );
}
