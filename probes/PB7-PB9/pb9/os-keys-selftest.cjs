"use strict";
// Runs the Windows key sender (sendkeys.ps1) through PowerShell 7 on Linux, where user32 does not
// exist: checks that the script compiles, that the INPUT struct is 40 bytes and that the line
// protocol answers. Real key delivery is only testable on a Windows runner.
const { windowsKeys } = require("./os-keys.cjs");

(async () => {
  const keys = windowsKeys("PB9-GAME");
  await keys.start();
  const focus = await keys.focus();
  const send = await keys.send([["down", "KeyR"], ["up", "KeyR"]], 5);
  await keys.stop();
  const result = { ready: keys.ready, focus, send };
  console.log(`PB9_PS_SELFTEST ${JSON.stringify(result)}`);
  const ok = keys.ready && keys.ready.ready === true && keys.ready.inputSize === 40 && focus.ok === false && send.ok === false;
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.log(`PB9_PS_SELFTEST_FATAL ${String(error && error.stack ? error.stack : error)}`);
  process.exit(1);
});
