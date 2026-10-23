import type { Migration } from "./database";

export const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS documents (
          plugin TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('global', 'account')),
          account TEXT NOT NULL, name TEXT NOT NULL, json TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          PRIMARY KEY (plugin, scope, account, name)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS credentials (account TEXT PRIMARY KEY, ciphertext BLOB NOT NULL) STRICT;
    `,
  },
  {
    version: 2,
    sql: `
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
          created_at INTEGER NOT NULL
        ) STRICT;
    `,
  },
];
