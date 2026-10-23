import { accountId } from "@moxi/contracts";
import { AccountError, type StoredAccount } from "./accounts";
import { defineSettings } from "./settings";
import type { Database } from "./database";

/** The accounts marked for "Play selected". They stay marked until the player unmarks them. */
export function createAccountSelection(db: Database, log?: (message: string) => void) {
  const settings = defineSettings(
    db,
    { selectedAccounts: { schema: accountId.array(), default: [] } },
    log ? { log } : {},
  );
  const stored = () => new Set<string>(settings.get("selectedAccounts"));
  return {
    /** The marked accounts that exist and are not archived. */
    ids(accounts: readonly StoredAccount[]): Set<string> {
      const marked = stored();
      return new Set(
        accounts
          .filter((entry) => !entry.archived && marked.has(entry.id))
          .map((entry) => entry.id),
      );
    },
    /** Replaces the marks. Only accounts that exist and are not archived can be marked. */
    set(ids: readonly string[], accounts: readonly StoredAccount[]) {
      const markable = new Set(
        accounts.filter((entry) => !entry.archived).map((entry) => entry.id),
      );
      if (ids.some((id) => !markable.has(id)))
        throw new AccountError("This account no longer exists.");
      settings.set("selectedAccounts", [...new Set(ids)].sort());
    },
    /** An archived or deleted account loses its mark, so restoring it does not bring it back. */
    drop(id: string) {
      const marked = stored();
      if (marked.delete(id)) settings.set("selectedAccounts", [...marked].sort());
    },
  };
}
