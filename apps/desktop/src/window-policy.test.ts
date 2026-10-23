import { expect, test } from "vite-plus/test";
import type { Account } from "@moxi/contracts";
import {
  accountMenuModel,
  afterPlay,
  onGameClosed,
  onLauncherClose,
  sameMenuModel,
} from "./window-policy";

const account = (id: string, name: string, extra: Partial<Account> = {}): Account => ({
  id,
  name,
  archived: false,
  selected: false,
  state: "closed",
  ...extra,
});

test.each([
  [2, "hide-launcher"],
  [1, "hide-launcher"],
  [0, "keep-launcher"],
] as const)("after Play with %i game windows shown the launcher: %s", (shown, expected) => {
  // A failed Play shows nothing, and the launcher must stay for the player to recover.
  expect(afterPlay(shown)).toBe(expected);
});

test.each([
  [1, false, "hide"],
  [2, false, "hide"],
  [0, false, "close"],
  [1, true, "close"],
] as const)(
  "closing the launcher with %i games open (quitting: %s): %s",
  (gameWindows, quitting, expected) => {
    // Command-Q must not be blocked by a launcher that hides itself instead of closing.
    expect(onLauncherClose({ gameWindows, quitting })).toBe(expected);
  },
);

test.each([
  [0, false, "reveal-launcher"],
  [1, false, "nothing"],
  [0, true, "nothing"],
] as const)(
  "a game closes leaving %i games (quitting: %s): %s",
  (gameWindows, quitting, expected) => {
    // Quitting closes every game in turn; the launcher must not flash up between them.
    expect(onGameClosed({ gameWindows, quitting })).toBe(expected);
  },
);

test("the Accounts menu lists accounts that are not archived, with their state", () => {
  expect(
    accountMenuModel([
      account("a", "Main account"),
      account("b", "Storage", { state: "running" }),
      account("c", "Crashed", { state: "failed", failure: "renderer-crash" }),
      account("d", "Old", { archived: true }),
    ]),
  ).toEqual([
    { id: "a", label: "Main account", enabled: true },
    { id: "b", label: "Storage — Open", enabled: true },
    { id: "c", label: "Crashed — Try again", enabled: true },
  ]);
});

test("the menu is rebuilt when a name or a state changes, and only then", () => {
  const before = accountMenuModel([account("a", "Main"), account("b", "Other")]);
  expect(
    sameMenuModel(before, accountMenuModel([account("a", "Main"), account("b", "Other")])),
  ).toBe(true);
  expect(
    sameMenuModel(
      before,
      accountMenuModel([account("a", "Main"), account("b", "Other", { state: "running" })]),
    ),
  ).toBe(false);
  expect(
    sameMenuModel(before, accountMenuModel([account("a", "Renamed"), account("b", "Other")])),
  ).toBe(false);
  expect(sameMenuModel(before, accountMenuModel([account("a", "Main")]))).toBe(false);
});
