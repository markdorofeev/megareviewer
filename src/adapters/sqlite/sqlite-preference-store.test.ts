import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  describePreferenceStoreContract,
  FixedClock,
  RecordingLogger,
} from "../../application/testing/index.ts";
import {
  type Preference,
  PreferenceId,
  type ReviewSignal,
  SignalKey,
} from "../../domain/review/index.ts";
import { openSqliteAnalysisStore, type SqliteAnalysisStore } from "./index.ts";

const root = mkdtempSync(join(tmpdir(), "megareviewer-preferences-"));
let tempCount = 0;
const tempPath = (): string => {
  tempCount += 1;
  return join(root, `db-${tempCount}.sqlite`);
};

const open: SqliteAnalysisStore[] = [];
const openStore = (path: string, logger = new RecordingLogger()): SqliteAnalysisStore => {
  const store = openSqliteAnalysisStore({ path, clock: new FixedClock(), logger });
  open.push(store);
  return store;
};

afterEach(() => {
  for (const store of open.splice(0)) store.close();
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describePreferenceStoreContract("sqlite-memory", () => openStore(":memory:"));
describePreferenceStoreContract("sqlite-file", () => openStore(tempPath()));

const repo = { host: "github", owner: "acme", repo: "shop" } as const;
const preference: Preference = {
  id: PreferenceId.parse("pref_00000000000000a1"),
  kind: "dont-flag",
  text: "Naming of test helpers",
  scope: { kind: "repo", repo },
  source: "learned",
  enabled: true,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};
const signal: ReviewSignal = {
  kind: "dismissed",
  at: "2026-11-03T10:00:00.000Z",
  pullRequest: { repo, number: 12 },
  pointKind: "finding",
  title: "Rename `tmp`",
  text: "",
  path: "src/config.ts",
};

describe("the SQLite preference store", () => {
  it("keeps what it holds across a restart", async () => {
    const path = tempPath();
    const first = openStore(path);
    await first.savePreference(preference);
    await first.recordSignal(SignalKey.parse("point:a:f1"), signal);
    await first.setGuidelineSwitch(repo, "CLAUDE.md", true);
    first.close();

    const second = openStore(path);

    expect(await second.listPreferences()).toEqual([preference]);
    expect(await second.listSignals(10)).toEqual([signal]);
    expect(await second.getGuidelineSwitches(repo)).toEqual(new Map([["CLAUDE.md", true]]));
  });

  it("leaves out rows that no longer parse, and logs each", async () => {
    const path = tempPath();
    const logger = new RecordingLogger();
    const store = openStore(path, logger);
    await store.savePreference(preference);
    await store.recordSignal(SignalKey.parse("point:a:f1"), signal);
    const db = new DatabaseSync(path);
    db.exec(`INSERT INTO preferences VALUES
      ('p1', 'look-for', 'An id of another shape', NULL, NULL, NULL, 'written', 1, 't', 't')`);
    db.exec(`INSERT INTO preference_proposals VALUES
      ('prop_00000000000000b1', 'look-for', 'Naming', NULL, NULL, NULL, 'learned', 'not json',
       'pending', '2026-11-02T10:00:00.000Z')`);
    db.exec(`INSERT INTO review_signals VALUES
      ('point:a:f2', 'raised', 'yesterday', 'github', 'acme', 'shop', 12, 'finding', 'T', '', NULL)`);
    db.close();

    expect(await store.listPreferences()).toEqual([preference]);
    expect(await store.listProposals()).toEqual([]);
    expect(await store.listSignals(10)).toEqual([signal]);
    expect(
      logger.entries.filter((entry) => entry.level === "warn").map((entry) => entry.message),
    ).toEqual([
      "Ignoring a stored preference that no longer parses",
      "Ignoring a stored preference proposal that no longer parses",
      "Ignoring a stored review signal that no longer parses",
    ]);
  });
});
