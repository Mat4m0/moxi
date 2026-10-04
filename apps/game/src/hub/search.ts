export type Searchable = {
  id: string;
  title: string;
  keywords?: readonly string[] | undefined;
  aliases?: readonly string[] | undefined;
  scope?: string | undefined;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const words = (s: string) =>
  norm(s)
    .split(/[\s\-–—·,/]+/)
    .filter(Boolean);

export function tier(item: Searchable, query: string): number | null {
  const q = norm(query);
  if (!q) return 2;
  const title = norm(item.title);
  if (title === q || item.aliases?.some((a) => norm(a) === q)) return 0;
  if (title.startsWith(q)) return 1;
  const haystack = [...words(item.title), ...(item.keywords ?? []).flatMap(words)];
  return words(q).every((w) => haystack.some((h) => h.startsWith(w))) ? 2 : null;
}

export function parseScope(
  query: string,
  scopes: ReadonlySet<string>,
): { scope: string | null; text: string } {
  const m = /^(\S+)\s+(.*)$/.exec(query.trimStart());
  if (m?.[1] && m[2] !== undefined && scopes.has(m[1].toLowerCase()))
    return { scope: m[1].toLowerCase(), text: m[2] };
  return { scope: null, text: query };
}

export function rank<T extends Searchable>(items: readonly T[], query: string): T[] {
  const scored: [T, number][] = [];
  for (const item of items) {
    const t = tier(item, query);
    if (t !== null) scored.push([item, t]);
  }
  return scored
    .sort(
      (a, b) =>
        a[1] - b[1] || a[0].title.localeCompare(b[0].title) || a[0].id.localeCompare(b[0].id),
    )
    .map(([item]) => item);
}
