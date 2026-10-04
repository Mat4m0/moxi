import { resolve, sep } from "node:path";
export function resolveRendererPath(
  rawUrl: string,
  roots: Record<"launcher" | "game" | "plugin-host", string>,
): string | undefined {
  try {
    // Inspect before URL normalization, which would hide dot segments.
    const rawPath = /^moxi:\/\/app(\/[^?#]*)?(?:[?#]|$)/.exec(rawUrl)?.[1] ?? "";
    const decoded = decodeURIComponent(rawPath);
    if (
      !decoded ||
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      decoded.split("/").some((part) => part === "." || part === "..")
    )
      return;
    const url = new URL(rawUrl);
    if (url.protocol !== "moxi:" || url.host !== "app" || url.username || url.password) return;
    const [, kind, ...parts] = decoded.split("/");
    if (kind !== "launcher" && kind !== "game" && kind !== "plugin-host") return;
    const root = resolve(roots[kind]);
    const file = resolve(root, parts.join("/") || "index.html");
    return file.startsWith(root + sep) ? file : undefined;
  } catch {
    return;
  }
}
