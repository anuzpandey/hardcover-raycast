import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Icon,
  Toast,
  showToast,
  useNavigation,
  Keyboard,
} from "@raycast/api";
import { useState } from "react";
import {
  genreOf,
  toEntry,
  toJson,
  type BookEntry,
  type EntryOverrides,
} from "./book-json";
import { downloadCover } from "./download";
import type { HardcoverBook, Options } from "./hardcover";
import { pushToHardcover } from "./push";
import { writeEntryDefaults, type EntryDefaults } from "./store";

const SHELVES: { value: BookEntry["status"]; title: string }[] = [
  { value: "purchased", title: "Purchased" },
  { value: "to_buy", title: "To Buy" },
];

const READING: { value: BookEntry["reading"]; title: string }[] = [
  { value: "unread", title: "Want to Read" },
  { value: "reading", title: "Reading" },
  { value: "finished", title: "Finished" },
];

/**
 * Fills in the fields Hardcover cannot know -- which shelf a book is on, how
 * far through it you are, what you made of it -- before the JSON is copied.
 */
export function ShelfForm({
  book,
  options,
  defaults,
  onRecorded,
}: {
  book: HardcoverBook;
  options: Options;
  defaults: EntryDefaults;
  onRecorded: () => void | Promise<void>;
}) {
  const { pop } = useNavigation();

  const [status, setStatus] = useState<string>(defaults.status);
  const [reading, setReading] = useState<string>(defaults.reading);
  const [rating, setRating] = useState<string>("");
  const [genre, setGenre] = useState<string>(genreOf(book) ?? "");
  const [notes, setNotes] = useState<string>("");

  const overrides = (): EntryOverrides => ({
    status: status as BookEntry["status"],
    reading: reading as BookEntry["reading"],
    rating: rating === "" ? null : Number.parseInt(rating, 10),
    genre: genre.trim() === "" ? null : genre.trim(),
    notes: notes.trim() === "" ? null : notes.trim(),
  });

  const remember = async () => {
    await writeEntryDefaults({ status, reading });
    await onRecorded();
  };

  const copy = async () => {
    await Clipboard.copy(toJson(book, options, overrides()));
    await remember();
    await showToast({
      style: Toast.Style.Success,
      title: "Copied as JSON",
      message: `${book.title} · ${status === "purchased" ? "Purchased" : "To Buy"}`,
    });
    pop();
  };

  const copyAndDownload = async () => {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Copying and downloading…",
    });

    try {
      await Clipboard.copy(toJson(book, options, overrides()));
      const result = await downloadCover(book, options);
      await remember();

      toast.style = Toast.Style.Success;
      toast.title = "Copied and cover saved";
      toast.message = `${result.path} · ${Math.round(result.bytes / 1024)} KB`;
      pop();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Cover download failed";
      toast.message = error instanceof Error ? error.message : String(error);
    }
  };

  /**
   * Sends the same state to Hardcover that the JSON records, so the shelf on
   * the site and the shelf in the repo cannot drift apart. Reading progress is
   * left alone deliberately -- that is logged in the app while actually
   * reading, and a push from here has no page count to offer it.
   */
  const push = async () => {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Saving to Hardcover…",
    });

    try {
      const result = await pushToHardcover(
        book,
        toEntry(book, options, overrides()),
      );
      await remember();

      toast.style = Toast.Style.Success;
      toast.title = result.summary;
      toast.message = book.title;

      return true;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Hardcover save failed";
      toast.message = error instanceof Error ? error.message : String(error);

      return false;
    }
  };

  const pushOnly = async () => {
    if (await push()) {
      pop();
    }
  };

  /**
   * The whole entry in one keystroke: clipboard, cover, Hardcover. The copy
   * happens first because it cannot fail, so a network error still leaves the
   * JSON ready to paste.
   */
  const copyDownloadAndPush = async () => {
    await Clipboard.copy(toJson(book, options, overrides()));

    try {
      await downloadCover(book, options);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Cover download failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (await push()) {
      pop();
    }
  };

  return (
    <Form
      navigationTitle={book.title}
      actions={
        <ActionPanel>
          <Action title="Copy as JSON" icon={Icon.Clipboard} onAction={copy} />
          <Action
            title="Copy as JSON and Download Cover"
            icon={Icon.Download}
            shortcut={Keyboard.Shortcut.Common.Save}
            onAction={copyAndDownload}
          />
          <Action
            title="Copy, Download Cover and Save to Hardcover"
            icon={Icon.Stars}
            shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
            onAction={copyDownloadAndPush}
          />
          <Action
            title="Save to Hardcover"
            icon={Icon.Bookmark}
            shortcut={{ modifiers: ["cmd"], key: "return" }}
            onAction={pushOnly}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title={book.title}
        text={preview(book, options, overrides())}
      />

      <Form.Dropdown
        id="status"
        title="Shelf"
        value={status}
        onChange={setStatus}
      >
        {SHELVES.map((shelf) => (
          <Form.Dropdown.Item
            key={shelf.value}
            value={shelf.value}
            title={shelf.title}
          />
        ))}
      </Form.Dropdown>

      <Form.Dropdown
        id="reading"
        title="Reading"
        value={reading}
        onChange={setReading}
      >
        {READING.map((state) => (
          <Form.Dropdown.Item
            key={state.value}
            value={state.value}
            title={state.title}
          />
        ))}
      </Form.Dropdown>

      <Form.Dropdown
        id="rating"
        title="Rating"
        value={rating}
        onChange={setRating}
      >
        <Form.Dropdown.Item value="" title="Not rated" />
        {[1, 2, 3, 4, 5].map((n) => (
          <Form.Dropdown.Item key={n} value={String(n)} title={"★".repeat(n)} />
        ))}
      </Form.Dropdown>

      <Form.TextField
        id="genre"
        title="Genre"
        placeholder="e.g. Horror"
        value={genre}
        onChange={setGenre}
        info="Hardcover's own genres are unreliable, so this is yours to set."
      />

      <Form.TextArea
        id="notes"
        title="Notes"
        placeholder="Why this one?"
        value={notes}
        onChange={setNotes}
      />
    </Form>
  );
}

/** A short read-out of the fields the form controls, so the result is visible before copying. */
function preview(
  book: HardcoverBook,
  options: Options,
  overrides: EntryOverrides,
): string {
  const entry = JSON.parse(toJson(book, options, overrides)) as BookEntry;

  return [
    `${entry.authors.join(", ") || "Unknown author"}${entry.year ? ` · ${entry.year}` : ""}`,
    `${entry.status} · ${entry.reading}${entry.rating ? ` · ${"★".repeat(entry.rating)}` : ""}`,
    entry.img,
  ].join("\n");
}
