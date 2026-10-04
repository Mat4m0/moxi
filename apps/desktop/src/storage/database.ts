import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
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
  onQuarantine,
}: {
  file: string;
  backupDir: string;
  appVersion: string;
  migrations: readonly Migration[];
  onQuarantine?: (file: string) => void;
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
  let existed = existsSync(file);
  mkdirSync(dirname(file), { recursive: true });
  let db: Database | undefined;
  const checkDir = existed ? mkdtempSync(join(dirname(file), ".integrity-")) : null;
  try {
    // SQLite can change sidecars while checking; use copies to keep damaged files intact.
    const checkFile = checkDir ? join(checkDir, "moxi.sqlite") : file;
    if (checkDir)
      for (const suffix of ["", "-wal", "-shm"])
        if (existsSync(file + suffix)) copyFileSync(file + suffix, checkFile + suffix);
    db = new DatabaseSync(checkFile);
    const check = db.prepare("PRAGMA quick_check").all();
    if (check.length !== 1 || check[0]?.quick_check !== "ok")
      throw Object.assign(new Error("Database integrity check failed."), { errcode: 11 });
  } catch (error) {
    db?.close();
    if (
      !(
        error instanceof Error &&
        "errcode" in error &&
        typeof error.errcode === "number" &&
        [11, 26].includes(error.errcode & 255)
      )
    )
      throw error;
    let date = new Date();
    let quarantined = `${file}.corrupt-${date.toISOString().replaceAll(":", "-")}`;
    while (["", "-wal", "-shm"].some((suffix) => existsSync(quarantined + suffix))) {
      date = new Date(date.getTime() + 1);
      quarantined = `${file}.corrupt-${date.toISOString().replaceAll(":", "-")}`;
    }
    for (const suffix of ["", "-wal", "-shm"])
      if (existsSync(file + suffix)) renameSync(file + suffix, quarantined + suffix);
    onQuarantine?.(quarantined);
    existed = false;
  } finally {
    if (db?.isOpen) db.close();
    if (checkDir) rmSync(checkDir, { recursive: true, force: true });
  }
  db = new DatabaseSync(file);
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
