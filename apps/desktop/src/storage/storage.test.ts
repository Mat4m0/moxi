import { afterEach, expect, test, vi } from "vite-plus/test";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type } from "arktype";
import {
  openDatabase,
  migrations,
  defineSettings,
  docs,
  createCredentialStore,
  type Database,
  type Migration,
} from "./index";

const directories: string[] = [];
const databases: Database[] = [];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "moxi-storage-"));
  directories.push(directory);
  const options = {
    file: join(directory, "moxi.sqlite"),
    backupDir: join(directory, "backups"),
    appVersion: "0.1.0",
  };
  return {
    ...options,
    open(migrationList: readonly Migration[] = migrations) {
      const db = openDatabase({ ...options, migrations: migrationList });
      databases.push(db);
      return db;
    },
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) if (db.isOpen) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.useRealTimers();
});

test("opening without schema migrations cannot silently create unversioned tables", () => {
  const fixture = setup();
  const empty = fixture.open([]);
  expect(empty.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all()).toEqual([]);
  expect(empty.prepare("PRAGMA user_version").get()?.user_version).toBe(0);
  empty.close();
  const migrated = fixture.open(migrations);
  expect(
    migrated
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name),
  ).toEqual(["credentials", "documents", "settings"]);
  expect(migrated.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
});

test("a failed second pending migration cannot leave the first migration or version committed", () => {
  const fixture = setup();
  const db = fixture.open([
    ...migrations,
    { version: 2, sql: "CREATE TABLE player (name TEXT); INSERT INTO player VALUES ('original');" },
  ]);
  db.exec("INSERT INTO player VALUES ('wal-data')");
  db.close();
  expect(() =>
    fixture.open([
      ...migrations,
      { version: 3, sql: "UPDATE player SET name = 'changed'" },
      { version: 4, sql: "INSERT INTO missing_table VALUES (1)" },
    ]),
  ).toThrow();
  const reopened = fixture.open();
  expect(
    reopened
      .prepare("SELECT name FROM player ORDER BY rowid")
      .all()
      .map((row) => row.name),
  ).toEqual(["original", "wal-data"]);
  expect(reopened.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
  const backups = readdirSync(fixture.backupDir);
  expect(backups).toHaveLength(1);
  const backupName = backups[0];
  if (!backupName) throw new Error("Expected a migration backup.");
  const backup = new DatabaseSync(join(fixture.backupDir, backupName), { readOnly: true });
  databases.push(backup);
  expect(
    backup
      .prepare("SELECT name FROM player ORDER BY rowid")
      .all()
      .map((row) => row.name),
  ).toEqual(["original", "wal-data"]);
  expect(backup.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
});

test("a fourth migration backup removes the oldest while reopening without migrations adds none", () => {
  vi.useFakeTimers();
  const fixture = setup();
  fixture.open().close();
  for (const day of [1, 2, 3, 4]) {
    vi.setSystemTime(new Date(`2026-10-0${day}T12:00:00Z`));
    fixture.open([...migrations, { version: day + 1, sql: "SELECT 1" }]).close();
  }
  fixture.open().close();
  expect(readdirSync(fixture.backupDir).sort()).toEqual([
    "0.1.0-2026-10-02T12-00-00.000Z.sqlite",
    "0.1.0-2026-10-03T12-00-00.000Z.sqlite",
    "0.1.0-2026-10-04T12-00-00.000Z.sqlite",
  ]);
});

test("repeated migration attempts in one millisecond cannot overwrite an earlier backup", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
  const fixture = setup();
  fixture.open().close();
  fixture.open([...migrations, { version: 2, sql: "CREATE TABLE item (name TEXT)" }]).close();
  fixture.open([...migrations, { version: 3, sql: "INSERT INTO item VALUES ('saved')" }]).close();
  expect(readdirSync(fixture.backupDir).sort()).toEqual([
    "0.1.0-2026-10-04T12-00-00.000Z.sqlite",
    "0.1.0-2026-10-04T12-00-00.001Z.sqlite",
  ]);
});

test.each([[0], [1, 1], [2, 1], [1.5], [2147483648]])(
  "invalid migration sequence %j cannot modify existing data",
  (...versions) => {
    const fixture = setup();
    fixture
      .open([
        ...migrations,
        { version: 2, sql: "CREATE TABLE item (name TEXT); INSERT INTO item VALUES ('saved')" },
      ])
      .close();
    expect(() =>
      fixture.open([
        ...migrations,
        ...versions.map((version) => ({ version, sql: "DELETE FROM item" })),
      ]),
    ).toThrow("Migration versions must be positive and strictly increasing.");
    expect(
      fixture
        .open()
        .prepare("SELECT name FROM item")
        .all()
        .map((row) => row.name),
    ).toEqual(["saved"]);
  },
);

test.each([
  ["invalid JSON", "{"],
  ["wrong type", '"loud"'],
])("a stored setting with %s falls back without repeated log lines", (_reason, json) => {
  const db = setup().open();
  db.prepare("INSERT INTO settings VALUES (?, ?)").run("volume", json);
  const logs: string[] = [];
  const settings = defineSettings(
    db,
    { volume: { schema: type("0 <= number <= 100"), default: 50 } },
    { log: (message) => logs.push(message) },
  );
  expect(settings.get("volume")).toBe(50);
  expect(settings.all()).toEqual({ volume: 50 });
  expect(logs).toEqual(['Invalid stored setting "volume"; using default.']);
  expect(() => settings.set("volume", 101)).toThrow();
  settings.set("volume", 75);
  expect(settings.get("volume")).toBe(75);
});

test("stale document writes cannot overwrite fresh data or send a change event", () => {
  const fixture = setup();
  const db = fixture.open();
  const documents = docs(db);
  const ref = { plugin: "notes", scope: "global", account: null, name: "build" } as const;
  const changes: unknown[] = [];
  const unsubscribe = documents.onChange((change) => changes.push(change));
  expect(documents.read(ref)).toBeNull();
  expect(documents.write(ref, { text: "first" }, 0)).toEqual({ ok: true, revision: 1 });
  expect(documents.write(ref, { text: "stale" }, 0)).toEqual({ ok: false, revision: 1 });
  expect(documents.read(ref)).toEqual({ json: { text: "first" }, revision: 1 });
  expect(documents.write(ref, { text: "fresh" }, 1)).toEqual({ ok: true, revision: 2 });
  expect(changes).toEqual([
    { ref, revision: 1 },
    { ref, revision: 2 },
  ]);
  unsubscribe();
  expect(documents.write(ref, { text: "final" }, 2)).toEqual({ ok: true, revision: 3 });
  expect(changes).toHaveLength(2);
  db.close();
  expect(docs(fixture.open()).read(ref)).toEqual({ json: { text: "final" }, revision: 3 });
});

test("documents with the same name cannot leak between plugins and accounts", () => {
  const documents = docs(setup().open());
  const refs = [
    { plugin: "notes", scope: "global", account: null, name: "build" },
    { plugin: "notes", scope: "account", account: "alice", name: "build" },
    { plugin: "notes", scope: "account", account: "bob", name: "build" },
    { plugin: "other", scope: "global", account: null, name: "build" },
  ] as const;
  for (const [index, ref] of refs.entries()) documents.write(ref, index, 0);
  expect(refs.map((ref) => documents.read(ref))).toEqual([
    { json: 0, revision: 1 },
    { json: 1, revision: 1 },
    { json: 2, revision: 1 },
    { json: 3, revision: 1 },
  ]);
});

test.each([
  ["basic_text", true, "basic-text"],
  ["keychain", false, "encryption-unavailable"],
])("unsafe credentials backend %s cannot save plaintext", (backend, available, reason) => {
  const db = setup().open();
  const store = createCredentialStore({
    db,
    backend,
    isEncryptionAvailable: () => available,
    encrypt: () => {
      throw new Error("Encryption must not be called");
    },
    decrypt: () => {
      throw new Error("Decryption must not be called");
    },
  });
  expect(store.save("test-account", "synthetic-secret")).toEqual({ ok: false, reason });
  expect(store.load("test-account")).toBeNull();
  expect(db.prepare("SELECT count(*) AS count FROM credentials").get()?.count).toBe(0);
});

test("saved credentials survive reopening as encrypted blobs and clear removes them", () => {
  const fixture = setup();
  const key = randomBytes(32);
  const encryption = {
    backend: "keychain",
    isEncryptionAvailable: () => true,
    encrypt(secret: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decrypt(ciphertext: Buffer) {
      const decipher = createDecipheriv("aes-256-gcm", key, ciphertext.subarray(0, 12));
      decipher.setAuthTag(ciphertext.subarray(12, 28));
      return Buffer.concat([decipher.update(ciphertext.subarray(28)), decipher.final()]).toString(
        "utf8",
      );
    },
  };
  const db = fixture.open();
  const store = createCredentialStore({ db, ...encryption });
  expect(store.save("test-account", "synthetic-secret")).toEqual({ ok: true });
  expect(db.prepare("SELECT typeof(ciphertext) AS kind FROM credentials").get()?.kind).toBe("blob");
  db.close();
  const reopened = createCredentialStore({ db: fixture.open(), ...encryption });
  expect(reopened.load("test-account") === "synthetic-secret").toBe(true);
  reopened.clear("test-account");
  expect(reopened.load("test-account")).toBeNull();
});
