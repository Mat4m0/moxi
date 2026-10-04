import { expect, test } from "vite-plus/test";
import { resolveFolders } from "./folders.js";
test.each([
  [
    false,
    {},
    {
      data: process.platform === "win32" ? "\\repo\\.data" : "/repo/.data",
      gameCache: process.platform === "win32" ? "\\cache\\moxi-dev\\game" : "/cache/moxi-dev/game",
    },
  ],
  [
    true,
    {},
    {
      data: process.platform === "win32" ? "\\data\\Moxi" : "/data/Moxi",
      gameCache: process.platform === "win32" ? "\\data\\Moxi\\game" : "/data/Moxi/game",
    },
  ],
  [
    false,
    { MOXI_DATA_DIR: "/custom/data", MOXI_GAME_CACHE: "/custom/game" },
    { data: "/custom/data", gameCache: "/custom/game" },
  ],
  [
    true,
    { MOXI_DATA_DIR: "/custom/data", MOXI_GAME_CACHE: "/custom/game" },
    { data: "/custom/data", gameCache: "/custom/game" },
  ],
])(
  "keeps development data away from release data and honors overrides (%s, %j)",
  (packaged, env, expected) => {
    expect(
      resolveFolders({
        packaged,
        repoRoot: "/repo",
        env,
        platformDirs: { appData: "/data", cache: "/cache" },
      }),
    ).toEqual(expected);
  },
);
