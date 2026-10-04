import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;
export interface Migration {
  version: number;
  sql: string;
}

export function openDatabase({
  file,
  backupDir,
  appVersion,
  migrations,
}: {
  file: string;
  backupDir: string;
  appVersion: string;
  migrations: readonly Migration[];
}): Database {
  let previous = 0;
  for (const migration of migrations) {
    if (
      !Number.isSafeInteger(migration.version) ||
      migration.version <= previous ||
      migration.version > 2147483647
    ) {
      throw new Error("Migration versions must be positive and strictly increasing.");
    }
    previous = migration.version;
  }
  if (!/^[\w.-]+$/.test(appVersion)) throw new Error("Invalid app version for backup filename.");
  const existed = existsSync(file);
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    const current = db.prepare("PRAGMA user_version").get()?.user_version;
    if (typeof current !== "number") throw new Error("Cannot read database version.");
    const pending = migrations.filter(({ version }) => version > current);
    if (existed && pending.length) {
      // A WAL checkpoint puts all committed data in the file we copy.
      const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      if (checkpoint?.busy !== 0) throw new Error("Database is busy; cannot create a safe backup.");
      mkdirSync(backupDir, { recursive: true });
      let date = new Date();
      let backupFile = join(
        backupDir,
        `${appVersion}-${date.toISOString().replaceAll(":", "-")}.sqlite`,
      );
      while (existsSync(backupFile)) {
        date = new Date(date.getTime() + 1);
        backupFile = join(
          backupDir,
          `${appVersion}-${date.toISOString().replaceAll(":", "-")}.sqlite`,
        );
      }
      copyFileSync(file, backupFile, constants.COPYFILE_EXCL);
      const backups = readdirSync(backupDir)
        .filter((name) => /^.+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.sqlite$/.test(name))
        .sort((a, b) => b.slice(-31).localeCompare(a.slice(-31)));
      for (const backup of backups.slice(3)) rmSync(join(backupDir, backup));
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const migration of pending) {
        db.exec(migration.sql);
        db.exec(`PRAGMA user_version = ${migration.version}`);
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS documents (
          plugin TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('global', 'account')),
          account TEXT NOT NULL, name TEXT NOT NULL, json TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          PRIMARY KEY (plugin, scope, account, name)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS credentials (account TEXT PRIMARY KEY, ciphertext BLOB NOT NULL) STRICT;
      `);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
