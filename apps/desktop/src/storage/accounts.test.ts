import { afterEach, expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AccountError,
  createAccountSelection,
  createAccountStore,
  createCredentialStore,
  migrations,
  openDatabase,
  type Database,
} from "./index";

const directories: string[] = [];
const databases: Database[] = [];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "moxi-accounts-"));
  directories.push(directory);
  const open = () => {
    const db = openDatabase({
      file: join(directory, "moxi.sqlite"),
      backupDir: join(directory, "backups"),
      appVersion: "0.1.0",
      migrations,
    });
    databases.push(db);
    return db;
  };
  return { open, directory };
}
afterEach(() => {
  for (const db of databases.splice(0)) if (db.isOpen) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("a first run has one account to play, and reopening does not add another", () => {
  const fixture = setup();
  const first = fixture.open();
  const accounts = createAccountStore(first).list();
  expect(accounts.map(({ name, archived }) => ({ name, archived }))).toEqual([
    { name: "Main account", archived: false },
  ]);
  first.close();
  expect(
    createAccountStore(fixture.open())
      .list()
      .map(({ id }) => id),
  ).toEqual(accounts.map(({ id }) => id));
});

test("accounts keep the order they were added in, and a rename keeps the place", () => {
  const store = createAccountStore(setup().open());
  store.save({ id: "storage", name: "Storage" });
  store.save({ id: "heroes", name: "Heroes" });
  const [main] = store.list();
  if (!main) throw new Error("Expected the first account.");
  store.save({ id: main.id, name: "Mule" });
  expect(store.list().map(({ name }) => name)).toEqual(["Mule", "Storage", "Heroes"]);
});

test.each([
  ["", "Enter a name"],
  ["   ", "Enter a name"],
  ["x".repeat(49), "Enter a name"],
  ["bad\nname", "Enter a name"],
  ["storage", "Another account already uses this name."],
  ["  STORAGE ", "Another account already uses this name."],
])("refuses the name %j", (name, message) => {
  const store = createAccountStore(setup().open());
  store.save({ id: "storage", name: "Storage" });
  expect(() => store.save({ id: "other", name })).toThrow(AccountError);
  expect(() => store.save({ id: "other", name })).toThrow(message);
  expect(store.list()).toHaveLength(2);
});

test("saving an account again with its own name is not a duplicate, and the name is trimmed", () => {
  const store = createAccountStore(setup().open());
  store.save({ id: "storage", name: "  Storage " });
  store.save({ id: "storage", name: "Storage" });
  expect(store.list().at(-1)).toEqual({ id: "storage", name: "Storage", archived: false });
});

test("the last account in use cannot be archived, and an archived one can be restored", () => {
  const store = createAccountStore(setup().open());
  const [main] = store.list();
  if (!main) throw new Error("Expected the first account.");
  expect(() => store.archive(main.id, true)).toThrow("Keep at least one account");
  store.save({ id: "storage", name: "Storage" });
  store.archive("storage", true);
  expect(store.list().map(({ archived }) => archived)).toEqual([false, true]);
  store.archive("storage", false);
  expect(store.list().map(({ archived }) => archived)).toEqual([false, false]);
});

test("only an archived account can be deleted, and its own data goes with it", () => {
  const db = setup().open();
  const store = createAccountStore(db);
  store.save({ id: "storage", name: "Storage" });
  store.save({ id: "heroes", name: "Heroes" });
  const credentials = createCredentialStore({
    isEncryptionAvailable: () => true,
    encrypt: (text) => Buffer.from(text),
    decrypt: (bytes) => bytes.toString(),
    backend: "keychain",
    db,
  });
  credentials.save("storage", "secret");
  credentials.save("heroes", "other secret");
  db.prepare(
    "INSERT INTO documents (plugin, scope, account, name, json, revision) VALUES (?, ?, ?, ?, ?, 1)",
  ).run("notes", "account", "storage", "list", "[]");
  db.prepare(
    "INSERT INTO documents (plugin, scope, account, name, json, revision) VALUES (?, ?, ?, ?, ?, 1)",
  ).run("notes", "account", "heroes", "list", "[]");

  expect(() => store.remove("storage")).toThrow("Archive an account before deleting it.");
  store.archive("storage", true);
  store.remove("storage");

  expect(store.list().map(({ id }) => id)).not.toContain("storage");
  expect(db.prepare("SELECT account FROM documents").all()).toEqual([{ account: "heroes" }]);
  expect(db.prepare("SELECT account FROM credentials").all()).toEqual([{ account: "heroes" }]);
});

test("a database made before accounts lost their look still opens, with its accounts and appearance", () => {
  const fixture = setup();
  const old = openDatabase({
    file: join(fixture.directory, "moxi.sqlite"),
    backupDir: join(fixture.directory, "backups"),
    appVersion: "0.1.0",
    migrations: migrations.slice(0, 2),
  });
  databases.push(old);
  old
    .prepare(
      "INSERT INTO accounts (id, name, icon, color, archived, created_at) VALUES ('old', 'Old', 'star', '#496b58', 0, 1)",
    )
    .run();
  old
    .prepare(
      "INSERT INTO settings (key, json) VALUES ('uiStyle', '\"custom\"'), ('uiCustomTheme', '{}')",
    )
    .run();
  old.close();

  const db = fixture.open();
  expect(createAccountStore(db).list()).toEqual([{ id: "old", name: "Old", archived: false }]);
  expect(db.prepare("SELECT key FROM settings").all()).toEqual([]);
});

test("the marked accounts survive a restart", () => {
  const fixture = setup();
  const first = fixture.open();
  const store = createAccountStore(first);
  store.save({ id: "second", name: "Second" });
  createAccountSelection(first).set(["second"], store.list());
  first.close();
  const reopened = fixture.open();
  expect([...createAccountSelection(reopened).ids(createAccountStore(reopened).list())]).toEqual([
    "second",
  ]);
});

test("an account that is archived or deleted loses its mark, and restoring it does not bring it back", () => {
  const db = setup().open();
  const store = createAccountStore(db);
  const selection = createAccountSelection(db);
  store.save({ id: "second", name: "Second" });
  const main = store.list()[0]!.id;
  selection.set([main, "second"], store.list());

  store.archive("second", true);
  expect([...selection.ids(store.list())]).toEqual([main]);
  selection.drop("second");
  store.archive("second", false);
  expect([...selection.ids(store.list())]).toEqual([main]);

  store.archive("second", true);
  store.remove("second");
  selection.drop("second");
  expect([...selection.ids(store.list())]).toEqual([main]);
});

test.each([
  ["an account that does not exist", ["ghost"]],
  ["an archived account", ["archived"]],
])("marking %s is refused and changes nothing", (_case, ids) => {
  const db = setup().open();
  const store = createAccountStore(db);
  const selection = createAccountSelection(db);
  store.save({ id: "archived", name: "Archived" });
  const main = store.list()[0]!.id;
  selection.set([main], store.list());
  store.archive("archived", true);
  expect(() => selection.set(ids, store.list())).toThrow(AccountError);
  expect([...selection.ids(store.list())]).toEqual([main]);
});
