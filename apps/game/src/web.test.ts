import { expect, test } from "vite-plus/test";
import { rewriteWebUrl } from "./web";

const page = new URL("moxi://app/game/");

test.each([
  // The glue builds https://<page host>/<route>/... : a plain https URL to a host that is not there.
  ["https://app/webgate/my_account/token.xml", "moxi://app/webgate/my_account/token.xml"],
  ["https://app/account/login.xml?x=1", "moxi://app/account/login.xml?x=1"],
  ["http://app/Help/page", "moxi://app/Help/page"],
  ["/www/index.html", "moxi://app/www/index.html"],
])("%s goes to the proxy", (url, expected) => {
  expect(rewriteWebUrl(url, page)).toBe(expected);
});

test.each([
  // A real ArenaNet host or an unknown route must never be rerouted into the proxy.
  "https://account.arena.net/login.xml",
  "https://app/evil/login.xml",
  "https://other/webgate/x",
  "moxi://app/client/Gw.jspi.wasm",
])("%s is left alone", (url) => {
  expect(rewriteWebUrl(url, page)).toBeUndefined();
});
