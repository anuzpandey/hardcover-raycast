import type { BookEntry } from "./book-json";

/**
 * Hardcover's user_book_statuses table, read from the live table rather than
 * assumed: the ids are not ordered by workflow, so guessing them from the UI
 * ordering would put Paused where Read belongs.
 */
export const STATUS = {
  WANT_TO_READ: 1,
  CURRENTLY_READING: 2,
  READ: 3,
  PAUSED: 4,
  DID_NOT_FINISH: 5,
  IGNORED: 6,
} as const;

/**
 * Hardcover has no "owned" status. Ownership is membership of a list, which is
 * what `edition_owned` manipulates behind the scenes -- it returns a
 * ListBookIdType, not a user_book. Keeping to the list directly means one
 * concept instead of two, and an insert that can be checked before it runs
 * rather than a toggle whose result depends on the current state.
 */
export const OWNED_LIST_NAME = "Owned";

/**
 * The shelf's `reading` field is the only one that maps onto a status.
 *
 * `status` (purchased / to_buy) is a separate axis -- see ownedFrom -- because
 * the two are genuinely independent on Hardcover: a book can be Want to Read
 * *and* owned, which is exactly what "bought it, haven't started it" means.
 * Collapsing them into one status would make that state unrepresentable.
 */
export function statusIdFrom(reading: BookEntry["reading"]): number {
  switch (reading) {
    case "reading":
      return STATUS.CURRENTLY_READING;
    case "finished":
      return STATUS.READ;
    default:
      return STATUS.WANT_TO_READ;
  }
}

export function ownedFrom(status: BookEntry["status"]): boolean {
  return status === "purchased";
}

/** What Hardcover currently holds for a book, as far as this extension cares. */
export interface ShelfState {
  /** The user_books row, when the book is on the shelf at all. */
  userBookId: number | null;
  statusId: number | null;
  rating: number | null;
  /** The list_books row in the Owned list, when the book is in it. */
  listBookId: number | null;
}

export interface DesiredState {
  statusId: number;
  owned: boolean;
  rating: number | null;
  privateNotes: string | null;
}

export interface PushPlan {
  shelf: "insert" | "update" | "unchanged";
  ownership: "add" | "remove" | "unchanged";
}

/**
 * Decides what actually has to be written, so a re-push of an unchanged book
 * costs nothing and -- more to the point -- does not produce a fresh entry in
 * the activity feed that everyone following the account sees.
 */
export function planPush(desired: DesiredState, current: ShelfState): PushPlan {
  return {
    shelf: planShelf(desired, current),
    ownership: planOwnership(desired.owned, current.listBookId !== null),
  };
}

function planShelf(
  desired: DesiredState,
  current: ShelfState,
): PushPlan["shelf"] {
  if (current.userBookId === null) {
    return "insert";
  }

  // Notes are deliberately absent from this comparison: they are not read back
  // in the state query, so treating a difference as meaningful would make every
  // push with notes look like a change. Status and rating are the fields the
  // form can actually alter, and both are read back.
  const sameStatus = current.statusId === desired.statusId;
  const sameRating = ratingsMatch(current.rating, desired.rating);

  return sameStatus && sameRating ? "unchanged" : "update";
}

/**
 * A rating the form cannot express is not a disagreement. Hardcover stores
 * halves and the form offers whole stars, so a 3.5 on the site would otherwise
 * be flattened to 4 on the next unrelated push, silently losing the half.
 */
function ratingsMatch(current: number | null, desired: number | null): boolean {
  if (desired === null) {
    return true;
  }

  return current !== null && Math.abs(current - desired) < 0.01;
}

function planOwnership(
  wanted: boolean,
  present: boolean,
): PushPlan["ownership"] {
  if (wanted === present) {
    return "unchanged";
  }

  return wanted ? "add" : "remove";
}

export function planIsNoop(plan: PushPlan): boolean {
  return plan.shelf === "unchanged" && plan.ownership === "unchanged";
}

/** A one-line read-out of what a push did, for the toast. */
export function describePlan(plan: PushPlan, statusId: number): string {
  if (planIsNoop(plan)) {
    return "Already up to date";
  }

  const parts: string[] = [];

  if (plan.shelf === "insert") {
    parts.push(`Added as ${statusLabel(statusId)}`);
  } else if (plan.shelf === "update") {
    parts.push(`Set to ${statusLabel(statusId)}`);
  }

  if (plan.ownership === "add") {
    parts.push("marked owned");
  } else if (plan.ownership === "remove") {
    parts.push("unmarked owned");
  }

  return parts.join(" · ");
}

export function statusLabel(statusId: number): string {
  switch (statusId) {
    case STATUS.WANT_TO_READ:
      return "Want to Read";
    case STATUS.CURRENTLY_READING:
      return "Currently Reading";
    case STATUS.READ:
      return "Read";
    case STATUS.PAUSED:
      return "Paused";
    case STATUS.DID_NOT_FINISH:
      return "Did Not Finish";
    case STATUS.IGNORED:
      return "Ignored";
    default:
      return `Status ${statusId}`;
  }
}
