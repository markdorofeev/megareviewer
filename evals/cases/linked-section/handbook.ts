import { type Area, areaDocument, areaSection } from "../../documents.ts";

const AREAS: readonly (readonly [name: string, owner: string])[] = [
  ["Refunds", "payments"],
  ["Dunning", "collections"],
  ["Tax rates", "tax"],
  ["Payment methods", "payments"],
  ["Statements", "reporting"],
  ["Credit notes", "reporting"],
  ["Fraud checks", "risk"],
  ["Price books", "catalog"],
  ["Coupons", "catalog"],
  ["Trials", "catalog"],
  ["Seats", "catalog"],
  ["Usage meters", "metering"],
  ["Exchange rates", "treasury"],
  ["Bank transfers", "treasury"],
  ["Card networks", "payments"],
  ["Disputes", "risk"],
  ["Payouts", "treasury"],
  ["Ledger closings", "treasury"],
  ["Revenue reports", "reporting"],
  ["Retention periods", "platform"],
  ["Backfills", "platform"],
  ["Feature flags", "platform"],
  ["Load tests", "platform"],
  ["Search indexes", "platform"],
  ["Customer portals", "portal"],
  ["Email templates", "portal"],
  ["Translations", "portal"],
  ["Mobile kits", "portal"],
  ["Partner accounts", "partners"],
  ["Sandboxes", "partners"],
  ["Support tools", "support"],
  ["Address checks", "risk"],
  ["Purchase orders", "collections"],
  ["Spending limits", "risk"],
  ["Reminders", "collections"],
  ["Cost centers", "reporting"],
  ["Discount approvals", "catalog"],
  ["Gift balances", "payments"],
  ["Settlement files", "treasury"],
  ["Identity checks", "risk"],
  ["Rate cards", "catalog"],
  ["Archive exports", "platform"],
  ["Bulk edits", "support"],
  ["Holiday calendars", "treasury"],
];

const areas = AREAS.map(([name, owner]): Area => ({ name, owner }));

/** The one section the pull request breaks a rule of. Nothing else in the handbook names events. */
export const EVENTS_RULES = `## Events

Other teams' services and customers' own systems subscribe to what this service publishes with \`publishEvent\`. They read it long after the code that published it has changed, so what's published is kept to four rules.

- **A name ends in a version.** It's the thing, what happened to it in the past tense, and a version: \`payment.settled.v1\`. A subscription matches the whole name, and the broker drops a name without a version and reports no error, so an event published without one reaches nobody.
- **A changed body is a new version,** published beside the old one for 90 days.
- **A body has IDs and times,** never an amount, a name or an address. A subscriber that needs more asks for it by ID, and gets what it's allowed to see.
- **An event is published after the change is stored,** never before.
`;

const HALF = 23;

/** 100 KB and more: a section an area, the events' among them. */
export const HANDBOOK = [
  areaDocument(
    "Handbook",
    "How each part of the billing service works, and the rules its team keeps. Read the section of the part you change.",
    areas.slice(0, HALF),
  ),
  EVENTS_RULES,
  ...areas.slice(HALF).map((area, index) => areaSection(area, HALF + index)),
].join("\n");
