// CI ONLY. Never start this on a developer Mac: it starts Electron.
// Runs the PB11 harness inside Electron's Main process (no BrowserWindow is ever created), so the
// stack is measured on the Node and TLS that Moxi ships (Electron 44.5.1: Node 24.21.0, BoringSSL).
const { app } = require('electron')

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  try {
    await import('./run.mjs') // ends with process.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
