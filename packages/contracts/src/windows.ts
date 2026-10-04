export const windowChannels = {
  launcher: ["app.info", "game.open"],
  game: [
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
