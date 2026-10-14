// PB10 only: splice the probe hook into Main before `pnpm build` in CI.
// The hook runs only when MOXI_PROBE_PB10 names an output file.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../../apps/desktop/src/shell/main.ts", import.meta.url);
let source = readFileSync(file, "utf8");
const replaceOnce = (anchor, replacement) => {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`PB10 anchor found ${count} times: ${anchor}`);
  source = source.replace(anchor, () => replacement);
};
const electronImport =
  'import { app, BrowserWindow, MessageChannelMain, net, protocol, session } from "electron";\n';
replaceOnce(
  electronImport,
  electronImport + 'import { pb10Probe } from "../../../../probes/PB10/main-hook.ts";\n',
);
replaceOnce(
  "      showLauncher();\n    })\n",
  `      showLauncher();
      if (process.env.MOXI_PROBE_PB10)
        pb10Probe({
          app,
          BrowserWindow,
          out: process.env.MOXI_PROBE_PB10,
          windows: () =>
            [...windows.values()]
              .filter(({ window }) => !window.isDestroyed())
              .map(({ kind, window }) => ({ kind, contents: window.webContents })),
          openGame: () => {
            if (!game || game.isDestroyed()) game = createWindow("game");
            reveal(game);
          },
          readiness: () => readiness.current(),
        });
    })
`,
);
writeFileSync(file, source);
console.log("PB10 hook spliced into apps/desktop/src/shell/main.ts");
