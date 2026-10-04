export const windowChannels = {
  launcher: ["app.info", "game.open"],
  game: ["app.info"],
  pluginHost: [],
} as const;
export type WindowKind = keyof typeof windowChannels;
