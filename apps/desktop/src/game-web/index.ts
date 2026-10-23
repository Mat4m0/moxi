import { isWebRoute, WEB_ROUTES, type WebRoute } from "@moxi/contracts/web";

// The official client's own web requests (login, account) go through one stateless proxy in Main.
// The client addresses `moxi://app/<route>/...`; only the hosts in `WEB_ROUTES` are reachable.
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
const METHODS = new Set(["GET", "POST", "PUT"]);
const DROPPED_REQUEST_HEADERS = new Set([
  "cookie",
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "origin",
  "referer",
]);
const DROPPED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-type-options",
]);

// A moxi://app/<route>/<rest> URL as the client sends it, or undefined when it is not a web route.
export function parseWebUrl(rawUrl: string): { route: WebRoute; upstream: string } | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if (url.protocol !== "moxi:" || url.host !== "app" || url.username || url.password) return;
  const [, label = "", ...rest] = url.pathname.split("/");
  const route = label.toLowerCase();
  if (!isWebRoute(route)) return;
  return { route, upstream: `https://${WEB_ROUTES[route]}/${rest.join("/")}${url.search}` };
}

export function upstreamHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of source)
    if (!DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  return headers;
}

// A redirect may only stay on the same allowlisted host; it is rewritten back onto the route.
function redirectTarget(route: WebRoute, location: string, upstream: string): string | undefined {
  let next: URL;
  try {
    next = new URL(location, upstream);
  } catch {
    return;
  }
  if (
    next.protocol !== "https:" ||
    next.hostname !== WEB_ROUTES[route] ||
    (next.port !== "" && next.port !== "443") ||
    next.username ||
    next.password
  )
    return;
  return `moxi://app/${route}${next.pathname}${next.search}`;
}

// Undefined means a redirect tried to leave its host.
export function responseHeaders(
  route: WebRoute,
  upstream: string,
  status: number,
  source: Headers,
): Headers | undefined {
  let location: string | undefined;
  if (status >= 300 && status < 400 && source.has("location")) {
    location = redirectTarget(route, source.get("location") ?? "", upstream);
    if (!location) return;
  }
  const headers = new Headers();
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (DROPPED_RESPONSE_HEADERS.has(lower)) continue;
    headers.set(name, lower === "location" && location ? location : value);
  }
  return headers;
}

function refusal(status: number, text: string) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export function createGameWeb(
  fetchUpstream: (url: string, init: RequestInit) => Promise<Response>,
) {
  return {
    // Undefined when the request is not for a web route, so the caller can keep routing it.
    async handle(request: Request): Promise<Response | undefined> {
      const target = parseWebUrl(request.url);
      if (!target) return;
      // Pages and sub-resources never use the proxy; only the client's XHR and fetch calls do.
      const kind = request.headers.get("sec-fetch-dest") ?? "";
      if (kind !== "" && kind !== "empty")
        return refusal(403, "The web proxy is for requests only.");
      const method = request.method.toUpperCase();
      if (!METHODS.has(method)) return refusal(405, "Method not allowed.");
      let body: Buffer | undefined;
      if (method !== "GET") {
        const declared = Number(request.headers.get("content-length") ?? 0);
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
          return refusal(413, "Request body too large.");
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength > MAX_BODY_BYTES) return refusal(413, "Request body too large.");
        body = Buffer.from(bytes);
      }
      try {
        const response = await fetchUpstream(target.upstream, {
          method,
          headers: upstreamHeaders(request.headers),
          // The proxy keeps no session: no cookies out, none stored, no following redirects.
          credentials: "omit",
          redirect: "manual",
          ...(body ? { body } : {}),
        });
        const headers = responseHeaders(
          target.route,
          target.upstream,
          response.status,
          response.headers,
        );
        if (!headers) return refusal(502, "Redirect refused.");
        return new Response(response.body, { status: response.status, headers });
      } catch {
        return refusal(502, "The web service could not be reached.");
      }
    },
  };
}
