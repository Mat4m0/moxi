import { join } from "node:path";
export function resolveFolders({
  packaged,
  repoRoot,
  env,
  platformDirs,
}: {
  packaged: boolean;
  repoRoot: string;
  env: { MOXI_DATA_DIR?: string; MOXI_GAME_CACHE?: string };
  platformDirs: { appData: string; cache: string };
}) {
  return {
    data:
      env.MOXI_DATA_DIR ??
      (packaged ? join(platformDirs.appData, "Moxi") : join(repoRoot, ".data")),
    gameCache:
      env.MOXI_GAME_CACHE ??
      (packaged
        ? join(platformDirs.appData, "Moxi", "game")
        : join(platformDirs.cache, "moxi-dev", "game")),
  };
}
