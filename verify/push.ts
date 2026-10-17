import {
  OWNED_LIST_NAME,
  STATUS,
  describePlan,
  ownedFrom,
  planIsNoop,
  planPush,
  statusIdFrom,
  statusLabel,
  type DesiredState,
  type ShelfState,
} from "../src/push-logic";

let failures = 0;
const check = (label: string, pass: boolean) => {
  if (!pass) failures++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
};

const state = (over: Partial<ShelfState> = {}): ShelfState => ({
  userBookId: null,
  statusId: null,
  rating: null,
  listBookId: null,
  ...over,
});

const want = (over: Partial<DesiredState> = {}): DesiredState => ({
  statusId: STATUS.WANT_TO_READ,
  owned: false,
  rating: null,
  privateNotes: null,
  ...over,
});

console.log("status mapping");
check("unread is Want to Read", statusIdFrom("unread") === STATUS.WANT_TO_READ);
check(
  "reading is Currently Reading",
  statusIdFrom("reading") === STATUS.CURRENTLY_READING,
);
check("finished is Read", statusIdFrom("finished") === STATUS.READ);
check(
  "ids match the live user_book_statuses table",
  STATUS.WANT_TO_READ === 1 &&
    STATUS.CURRENTLY_READING === 2 &&
    STATUS.READ === 3,
);

console.log("ownership mapping");
check("purchased is owned", ownedFrom("purchased") === true);
check("to_buy is not owned", ownedFrom("to_buy") === false);
check("the list is named Owned", OWNED_LIST_NAME === "Owned");

console.log("planning a new book");
check(
  "a book not on the shelf is inserted",
  planPush(want(), state()).shelf === "insert",
);
check(
  "an unpurchased wishlist book is inserted without ownership",
  planPush(want(), state()).ownership === "unchanged",
);
check(
  "a purchased but unstarted book is Want to Read AND owned",
  (() => {
    const plan = planPush(want({ owned: true }), state());
    return plan.shelf === "insert" && plan.ownership === "add";
  })(),
);

console.log("planning an existing book");
const onShelf = state({ userBookId: 1, statusId: STATUS.WANT_TO_READ });

check(
  "an unchanged book writes nothing",
  planIsNoop(planPush(want(), onShelf)),
);
check(
  "a changed status updates",
  planPush(want({ statusId: STATUS.READ }), onShelf).shelf === "update",
);
check(
  "buying a book already on the shelf only touches ownership",
  (() => {
    const plan = planPush(want({ owned: true }), onShelf);
    return plan.shelf === "unchanged" && plan.ownership === "add";
  })(),
);
check(
  "clearing purchased removes it from the list",
  planPush(
    want(),
    state({ userBookId: 1, statusId: STATUS.WANT_TO_READ, listBookId: 9 }),
  ).ownership === "remove",
);
check(
  "a book already owned is not added twice",
  planPush(
    want({ owned: true }),
    state({ userBookId: 1, statusId: STATUS.WANT_TO_READ, listBookId: 9 }),
  ).ownership === "unchanged",
);

console.log("ratings");
check(
  "an unrated form does not overwrite a rating set on the website",
  planIsNoop(
    planPush(
      want(),
      state({ userBookId: 1, statusId: STATUS.WANT_TO_READ, rating: 3.5 }),
    ),
  ),
);
check(
  "a new rating updates",
  planPush(
    want({ rating: 5 }),
    state({ userBookId: 1, statusId: STATUS.WANT_TO_READ, rating: 3 }),
  ).shelf === "update",
);
check(
  "the same rating does not",
  planIsNoop(
    planPush(
      want({ rating: 4 }),
      state({ userBookId: 1, statusId: STATUS.WANT_TO_READ, rating: 4 }),
    ),
  ),
);

console.log("summaries");
check(
  "a no-op says so",
  describePlan(planPush(want(), onShelf), STATUS.WANT_TO_READ) ===
    "Already up to date",
);
check(
  "an insert names the status",
  describePlan(
    planPush(want({ statusId: STATUS.READ }), state()),
    STATUS.READ,
  ) === "Added as Read",
);
check(
  "a purchase reads as both halves",
  describePlan(
    planPush(want({ owned: true }), state()),
    STATUS.WANT_TO_READ,
  ) === "Added as Want to Read · marked owned",
);
check("labels match the live table", statusLabel(5) === "Did Not Finish");

console.log(
  failures === 0 ? "\nall push checks passed" : `\n${failures} FAILED`,
);
if (failures > 0) process.exit(1);
