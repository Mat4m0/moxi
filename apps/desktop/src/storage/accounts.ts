import { accountAppearance, accountId, type AccountSave } from "@moxi/contracts";
import { accountNameProblem } from "@moxi/contracts/account-name";
import type { Database } from "./database";

export type StoredAccount = AccountSave & { archived: boolean };

/** A refusal the player can read: it names what to change. */
export class AccountError extends Error {}

const FIRST_ACCOUNT = { name: "Main account", icon: "swords", color: "#9a6638" } as const;

/** The accounts table. A first run gets one account, so the launcher is never empty. */
export function createAccountStore(db: Database, now: () => number = Date.now) {
  const select = db.prepare(
    "SELECT id, name, icon, color, archived FROM accounts ORDER BY created_at, rowid",
  );
  const find = db.prepare("SELECT id, name, archived FROM accounts WHERE id = ?");
  const insert = db.prepare(
    "INSERT INTO accounts (id, name, icon, color, archived, created_at) VALUES (?, ?, ?, ?, 0, ?)",
  );
  const update = db.prepare("UPDATE accounts SET name = ?, icon = ?, color = ? WHERE id = ?");
  const setArchived = db.prepare("UPDATE accounts SET archived = ? WHERE id = ?");
  const activeCount = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE archived = 0");

  function list(): StoredAccount[] {
    return select.all().map((row) => ({
      id: accountId.assert(row.id),
      name: String(row.name),
      archived: row.archived === 1,
      appearance: accountAppearance.assert({ icon: row.icon, color: row.color }),
    }));
  }
  function transaction<T>(work: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (list().length === 0)
    insert.run(
      crypto.randomUUID(),
      FIRST_ACCOUNT.name,
      FIRST_ACCOUNT.icon,
      FIRST_ACCOUNT.color,
      now(),
    );

  return {
    list,
    /** Adds an account with a new id, or edits the name and look of an existing one. */
    save(input: AccountSave) {
      const value = {
        id: accountId.assert(input.id),
        name: input.name.trim(),
        appearance: accountAppearance.assert(input.appearance),
      };
      const problem = accountNameProblem(value.name);
      if (problem) throw new AccountError(problem);
      transaction(() => {
        const taken = list().some(
          (stored) =>
            stored.id !== value.id &&
            stored.name.toLocaleLowerCase() === value.name.toLocaleLowerCase(),
        );
        if (taken) throw new AccountError("Another account already uses this name.");
        if (find.get(value.id))
          update.run(value.name, value.appearance.icon, value.appearance.color, value.id);
        else insert.run(value.id, value.name, value.appearance.icon, value.appearance.color, now());
      });
    },
    /** The last account in use cannot be archived: the launcher always has one to play. */
    archive(id: string, archived: boolean) {
      transaction(() => {
        const row = find.get(id);
        if (!row) throw new AccountError("This account no longer exists.");
        if (archived && row.archived === 0 && Number(activeCount.get()?.n) <= 1)
          throw new AccountError("Keep at least one account that is not archived.");
        setArchived.run(archived ? 1 : 0, id);
      });
    },
    /** Deletes an archived account with the plugin documents and the login stored for it. */
    remove(id: string) {
      transaction(() => {
        const row = find.get(id);
        if (!row) return;
        if (row.archived !== 1) throw new AccountError("Archive an account before deleting it.");
        db.prepare("DELETE FROM documents WHERE account = ?").run(id);
        db.prepare("DELETE FROM credentials WHERE account = ?").run(id);
        db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
      });
    },
  };
}
