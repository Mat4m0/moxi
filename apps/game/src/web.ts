import { isWebRoute } from "@moxi/contracts/web";

// The client sends its web calls to https://<this page's host>/<route>/..., a host that does not
// exist. Point them at the proxy route on this page's own origin; leave every other URL alone.
export function rewriteWebUrl(url: string | URL, page: Location | URL): string | undefined {
  let target: URL;
  try {
    target = new URL(url, page.href);
  } catch {
    return;
  }
  const label = target.pathname.split("/")[1]?.toLowerCase() ?? "";
  if (target.hostname !== page.hostname || !isWebRoute(label)) return;
  return `${page.protocol}//${page.host}${target.pathname}${target.search}`;
}

export function installWebRewrite() {
  // Called with the request as `this` below.
  // oxlint-disable-next-line typescript/unbound-method
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    return open.call(
      this,
      method,
      rewriteWebUrl(url, window.location) ?? url,
      async ?? true,
      username,
      password,
    );
  };
}
