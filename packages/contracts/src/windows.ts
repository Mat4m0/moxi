export const windowChannels = {
  launcher: [
    "client.readiness",
    "client.retry",
    "appearance.get",
    "appearance.set",
    "app.info",
    "game.open",
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
  ],
  pluginHost: [],
} as const;
export type WindowKind = keyof typeof windowChannels;

export const hubPortMessage = "moxi-hub-port";
