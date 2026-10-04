import { homedir } from "node:os";
import { join } from "node:path";
import { createClientCache } from "@moxi/desktop/game-files";

const cacheRoot =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Caches")
    : process.platform === "win32"
      ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
      : (process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"));
const dir = process.env.MOXI_GAME_CACHE ?? join(cacheRoot, "moxi-dev", "game");
const result = await createClientCache(dir).prepare();
console.log(`Generation: ${result.generationToken}`);
console.log(`Wasm sha256: ${result.hashes["Gw.jspi.wasm"]}`);
console.log(`Glue sha256: ${result.hashes["Gw.jspi.js"]}`);
console.log(`Total bytes: ${result.totalBytes}`);
