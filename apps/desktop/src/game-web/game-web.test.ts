import { expect, test } from "vite-plus/test";
import { createGameWeb, MAX_BODY_BYTES, parseWebUrl, responseHeaders } from "./index";

function proxy(upstream: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const web = createGameWeb(async (url, init) => {
    calls.push({ url, init });
    return upstream(url, init);
  });
  return { web, calls };
}

test.each([
  [
    "moxi://app/webgate/my_account/token.xml",
    "https://webgate.ncplatform.net/my_account/token.xml",
  ],
  ["moxi://app/Account/login.xml?a=1", "https://account.arena.net/login.xml?a=1"],
  ["moxi://app/www/", "https://www.guildwars.com/"],
])("%s is forwarded to %s", (url, upstream) => {
  expect(parseWebUrl(url)?.upstream).toBe(upstream);
});

test.each([
  // An unknown first label or another page of the app must never reach the network.
  "moxi://app/evil/x",
  "moxi://app/game/index.html",
  "moxi://other/webgate/x",
  "https://app/webgate/x",
  "moxi://user@app/webgate/x",
])("%s is not a web route", (url) => {
  expect(parseWebUrl(url)).toBeUndefined();
});

test("cookies and origin headers are not forwarded, and the request is stateless", async () => {
  const { web, calls } = proxy(() => new Response("ok"));
  await web.handle(
    new Request("moxi://app/account/login.xml", {
      headers: {
        Cookie: "sid=1",
        Origin: "moxi://app",
        Referer: "moxi://app/game/",
        "X-Keep": "1",
      },
    }),
  );
  const headers = new Headers(calls[0]?.init.headers);
  expect([...headers.keys()]).toEqual(["x-keep"]);
  expect(calls[0]?.init).toMatchObject({ credentials: "omit", redirect: "manual", method: "GET" });
});

test("a response cannot set cookies or replace the page policy", async () => {
  const { web } = proxy(
    () =>
      new Response("ok", {
        headers: { "Set-Cookie": "a=b", "Content-Security-Policy": "default-src *", "X-Ok": "1" },
      }),
  );
  const response = await web.handle(new Request("moxi://app/webgate/x"));
  expect([...(response?.headers.keys() ?? [])]).toEqual(["content-type", "x-ok"]);
});

test("a redirect off the allowlisted host is refused, a same-host one is rewritten", () => {
  const upstream = "https://account.arena.net/a";
  const redirect = (location: string) =>
    responseHeaders("account", upstream, 302, new Headers({ Location: location }));
  expect(redirect("https://evil.example/")).toBeUndefined();
  expect(redirect("http://account.arena.net/b")).toBeUndefined();
  expect(redirect("https://account.arena.net:8443/b")).toBeUndefined();
  expect(redirect("/b?c=1")?.get("location")).toBe("moxi://app/account/b?c=1");
});

test("an oversized body, a bad method or a page load is refused before any request", async () => {
  const { web, calls } = proxy(() => new Response("ok"));
  const big = new Uint8Array(MAX_BODY_BYTES + 1);
  const post = (body: Uint8Array) => new Request("moxi://app/webgate/x", { method: "POST", body });
  expect((await web.handle(post(big)))?.status).toBe(413);
  expect(
    (await web.handle(new Request("moxi://app/webgate/x", { method: "DELETE" })))?.status,
  ).toBe(405);
  const page = new Request("moxi://app/webgate/x", { headers: { "Sec-Fetch-Dest": "document" } });
  expect((await web.handle(page))?.status).toBe(403);
  expect(calls).toEqual([]);
});

test("a failed upstream becomes one plain 502 and a non-route request is left to the caller", async () => {
  const web = createGameWeb(async () => {
    throw new Error("offline");
  });
  expect((await web.handle(new Request("moxi://app/help/x")))?.status).toBe(502);
  expect(await web.handle(new Request("moxi://app/game/index.html"))).toBeUndefined();
});
