// The ArenaNet web services the official client may reach, by the first label the client puts in
// the path. Main proxies them (apps/desktop game-web); the game page rewrites the client's URLs.
export const WEB_ROUTES = {
  webgate: "webgate.ncplatform.net",
  account: "account.arena.net",
  help: "help.guildwars.com",
  store: "store.guildwars.com",
  www: "www.guildwars.com",
} as const;
export type WebRoute = keyof typeof WEB_ROUTES;

export function isWebRoute(name: string): name is WebRoute {
  return Object.hasOwn(WEB_ROUTES, name);
}
