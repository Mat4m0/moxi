export const windowChannels = {
  launcher: [
    "download.pause",
    "download.resume",
    "client.readiness",
    "client.retry",
    "tools.list",
    "tools.set",
    "app.info",
    "accounts.list",
    "accounts.save",
    "accounts.archive",
    "accounts.remove",
    "accounts.select",
    "accounts.play",
  ],
  game: [
    "app.info",
    "game.client",
    "game.net.connect",
    "game.net.write",
    "game.net.close",
    "game.net.ack",
    "game.dns",
    "game.net.healthy",
    "game.client.failed",
  ],
  pluginHost: ["plugin.doc.read", "plugin.doc.write", "plugin.bundles", "tools.list"],
} as const;
export type WindowKind = keyof typeof windowChannels;

export const hubPortMessage = "moxi-hub-port";
