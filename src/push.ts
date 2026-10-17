import type { BookEntry } from "./book-json";
import { gql, type HardcoverBook } from "./hardcover";
import {
  OWNED_LIST_NAME,
  describePlan,
  ownedFrom,
  planIsNoop,
  planPush,
  statusIdFrom,
  type DesiredState,
  type PushPlan,
  type ShelfState,
} from "./push-logic";

/**
 * Writes a book's shelf state back to Hardcover.
 *
 * All the decisions live in push-logic.ts; this file is only the I/O around
 * them, the same split store.ts and store-logic.ts use.
 *
 * Every mutation here is visible to anyone following the account, so the read
 * that precedes them is not an optimisation -- it is what stops a re-push from
 * announcing a change that did not happen.
 */

interface StateResponse {
  me: {
    user_books: { id: number; status_id: number; rating: number | null }[];
    lists: { id: number; list_books: { id: number }[] }[];
  }[];
}

export interface PushResult {
  plan: PushPlan;
  summary: string;
  statusId: number;
}

/**
 * Current shelf state and the Owned list in a single round trip.
 *
 * `me` is a list in this schema rather than an object, so the account hangs
 * off index 0. The list is matched by name because the slug is derived from it
 * and a renamed list would still be the one the books are in.
 */
async function readState(
  bookId: number,
  signal?: AbortSignal,
): Promise<{ state: ShelfState; ownedListId: number | null }> {
  const query = `
    query ShelfState($bookId: Int!, $listName: String!) {
      me {
        user_books(where: {book_id: {_eq: $bookId}}, limit: 1) {
          id
          status_id
          rating
        }
        lists(where: {name: {_eq: $listName}}, limit: 1) {
          id
          list_books(where: {book_id: {_eq: $bookId}}, limit: 1) {
            id
          }
        }
      }
    }
  `;

  const data = await gql<StateResponse>(
    query,
    { bookId, listName: OWNED_LIST_NAME },
    signal,
  );

  const me = data.me?.[0];
  const userBook = me?.user_books?.[0] ?? null;
  const ownedList = me?.lists?.[0] ?? null;

  return {
    state: {
      userBookId: userBook?.id ?? null,
      statusId: userBook?.status_id ?? null,
      rating: userBook?.rating ?? null,
      listBookId: ownedList?.list_books?.[0]?.id ?? null,
    },
    ownedListId: ownedList?.id ?? null,
  };
}

/**
 * The Owned list, created on first use.
 *
 * A fresh account has no such list, and there is no API to mark ownership
 * without one -- `edition_owned` creates it implicitly, which is precisely the
 * hidden behaviour this avoids by doing it in the open.
 */
async function ensureOwnedList(existing: number | null): Promise<number> {
  if (existing !== null) {
    return existing;
  }

  const data = await gql<{ insert_list: { id: number } | null }>(
    `mutation CreateOwnedList($name: String!) {
      insert_list(object: {name: $name, privacy_setting_id: 1}) { id }
    }`,
    { name: OWNED_LIST_NAME },
  );

  const id = data.insert_list?.id;

  if (typeof id !== "number") {
    throw new Error(`Could not create the "${OWNED_LIST_NAME}" list.`);
  }

  return id;
}

export async function pushToHardcover(
  book: HardcoverBook,
  entry: BookEntry,
  signal?: AbortSignal,
): Promise<PushResult> {
  const desired: DesiredState = {
    statusId: statusIdFrom(entry.reading),
    owned: ownedFrom(entry.status),
    rating: entry.rating,
    privateNotes: entry.notes,
  };

  const { state, ownedListId } = await readState(book.id, signal);
  const plan = planPush(desired, state);

  if (planIsNoop(plan)) {
    return {
      plan,
      summary: describePlan(plan, desired.statusId),
      statusId: desired.statusId,
    };
  }

  if (plan.shelf === "insert") {
    await insertShelfRow(book.id, desired);
  } else if (plan.shelf === "update") {
    await updateShelfRow(state.userBookId as number, desired);
  }

  if (plan.ownership === "add") {
    await addToOwned(await ensureOwnedList(ownedListId), book);
  } else if (plan.ownership === "remove") {
    await removeFromOwned(state.listBookId as number);
  }

  return {
    plan,
    summary: describePlan(plan, desired.statusId),
    statusId: desired.statusId,
  };
}

async function insertShelfRow(
  bookId: number,
  desired: DesiredState,
): Promise<void> {
  const data = await gql<{
    insert_user_book: { id: number | null; error: string | null } | null;
  }>(
    `mutation AddBook($object: UserBookCreateInput!) {
      insert_user_book(object: $object) { id error }
    }`,
    {
      object: {
        book_id: bookId,
        status_id: desired.statusId,
        ...optionalFields(desired),
      },
    },
  );

  // insert_user_book reports refusals in an `error` field with a 200 status,
  // so a failed insert looks like a success to the transport layer.
  const error = data.insert_user_book?.error;

  if (error) {
    throw new Error(error);
  }
}

async function updateShelfRow(
  userBookId: number,
  desired: DesiredState,
): Promise<void> {
  const data = await gql<{
    update_user_book: { id: number | null; error: string | null } | null;
  }>(
    `mutation UpdateBook($id: Int!, $object: UserBookUpdateInput!) {
      update_user_book(id: $id, object: $object) { id error }
    }`,
    {
      id: userBookId,
      object: {
        status_id: desired.statusId,
        ...optionalFields(desired),
      },
    },
  );

  const error = data.update_user_book?.error;

  if (error) {
    throw new Error(error);
  }
}

/**
 * Rating and notes are omitted rather than sent as null when unset: null is a
 * value, and an update carrying it would erase a rating entered on the website
 * by someone who only meant to change the shelf here.
 */
function optionalFields(desired: DesiredState): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  if (desired.rating !== null) {
    fields.rating = desired.rating;
  }

  if (desired.privateNotes !== null && desired.privateNotes !== "") {
    fields.private_notes = desired.privateNotes;
  }

  return fields;
}

async function addToOwned(listId: number, book: HardcoverBook): Promise<void> {
  const editionId = book.default_cover_edition?.id ?? null;

  await gql<{ insert_list_book: { id: number } | null }>(
    `mutation MarkOwned($object: ListBookInput!) {
      insert_list_book(object: $object) { id }
    }`,
    {
      object: {
        list_id: listId,
        book_id: book.id,
        // Which edition is on the shelf matters -- page counts differ between
        // them and Hardcover measures reading progress against the edition --
        // but an unknown one should still record the ownership.
        ...(editionId === null ? {} : { edition_id: editionId }),
      },
    },
  );
}

async function removeFromOwned(listBookId: number): Promise<void> {
  await gql<{ delete_list_book: { id: number } | null }>(
    `mutation UnmarkOwned($id: Int!) {
      delete_list_book(id: $id) { id }
    }`,
    { id: listBookId },
  );
}
