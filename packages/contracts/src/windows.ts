export const windowChannels = {
  launcher: [
    "download.pause",
    "download.resume",
    "client.readiness",
    "client.retry",
    "appearance.get",
    "appearance.set",
    "app.info",
    "accounts.list",
    "accounts.save",
    "accounts.archive",
    "accounts.remove",
    "accounts.play",
  ],
  game: [
    "appearance.get",
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
  pluginHost: ["plugin.doc.read", "plugin.doc.write", "plugin.bundles"],
} as const;
export type WindowKind = keyof typeof windowChannels;

export const hubPortMessage = "moxi-hub-port";
