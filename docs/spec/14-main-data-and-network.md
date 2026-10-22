# 14 Main data and network

The data sources Main owns for plugins: documents, the network proxy and feeds, reference data and the activity log. Plugins
reach them only through membrane-stamped `plugin.*` channels (spec 07); Main enforces every budget itself. Every limit named
here is a key in spec 05 (`docs.*`, `reference.*`, `net.*`, `feed.*`, `activity.*`); this spec states no value.

## 1. Rules in force

1. Main owns every source in section 2. A plugin host never stores data, opens a socket or reads game files. Plugin data
   never reaches the launcher or a game renderer, except reference rows and names for host labels.
2. Document, reference and network work runs on Main's thread with per-install budgets, counted by Main itself (spec 07
   rule 11) with `createBucket` (spec 05 §2.2), an injected clock and in-memory counters. If P77's flood Measure shows
   event-loop delay over the spec 01 §1.6 target, documents move to a `worker_threads` worker. Decoding `Gw.dat` runs off Main's thread (M12-01).
3. Network: GET over `https:` and receive-only `wss:`, port 443, to an exact granted `net:` host. No cookies, ETags,
   persistent cache or TLS session reuse; no system proxy. TLS trusts the bundled Mozilla roots only (BD10).
4. Reference names are English; ids are the game's; professions are keyed by `Profession` (spec 04). Plugins get rows and ids, never images (spec 01 I9).
5. Activity is local: counts, host names, op ids and host labels; never URL paths or queries, message or note text, documents or action args.
6. ArenaNet's files stay untouched. Anything derived from `Gw.dat` is a rebuildable cache.

## 2. Data sources in Main

Files in `apps/desktop/src/plugins/`: `documents.ts` (`useDoc`, §3), `net.ts` (`useFetch`, §4), `feeds.ts` (`useFeed`, §5),
`reference.ts` (`useReference`, §6), `activity.ts` (no plugin access, §7). Not here: registry, grants, crashes, choices and
the action log (spec 12); the package store and signed feeds (`apps/desktop/src/feeds.ts`, `fetchSigned`; spec 15, keys in
§8). Shared types: `packages/sdk/src/host/data.ts` (wire shapes) and `host/urls.ts` (`grantedUrl`, `wikiUrl`, pure; Main, the
Hub and the test kit use them); `Activity` in `packages/contracts/src/activity.ts`.

## 3. Documents

### 3.1 Table

A new migration in merge order (slice M4-03, spec 12 §3) rebuilds the table; migration 1 stays unchanged (BD20).

```sql
CREATE TABLE documents_new (
  install_key TEXT NOT NULL, name TEXT NOT NULL, json TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'account')),
  account TEXT NOT NULL,          -- '' for global; else the window's accountId (spec 03 §1.12)
  bytes INTEGER NOT NULL CHECK (bytes > 0), -- UTF-8 bytes of json
  revision INTEGER NOT NULL CHECK (revision > 0),
  CHECK ((scope = 'global') = (account = '')),
  PRIMARY KEY (install_key, scope, account, name)
) STRICT;
INSERT INTO documents_new SELECT 'official/' || plugin, name, json, scope, account,
  length(CAST(json AS BLOB)), revision FROM documents;
DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;
```

- Old rows belong to bundled plugins, so they move to `official/<plugin id>`. No `REFERENCES` or `CASCADE` (foreign keys are
  off): uninstall deletes rows in one transaction (spec 12 §3). Until M9-01 every window has `accountId` `"default"`.

### 3.2 Types and service

```ts
// packages/sdk/src/host/data.ts — the plugin.doc.write response (spec 07 §3)
export type DocWriteReply =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly reason: "conflict"; readonly stored: Json | null; readonly revision: number }
  | { readonly ok: false; readonly reason: "quota" | "rate" };
// conflict: stored null with revision 0 = no stored document. The membrane coalesces by `revision` (spec 07 §8).
// The runtime maps the reply to the public WriteResult (spec 08 §3.5).

// apps/desktop/src/plugins/documents.ts (moved from storage/documents.ts)
export type DocKey = { readonly install: InstallKey; readonly scope: "global" | "account";
  readonly account: string; /* "" for global */ readonly name: string };
export function createDocuments(deps: {
  db: Database; now: () => number;
  count: (install: InstallKey, kind: "doc-refused", target: "quota" | "rate") => void; // §7
}): {
  read(key: DocKey): { value: Json; revision: number } | null;
  write(key: DocKey, value: Json, expectedRevision: number): DocWriteReply;
  usage(install: InstallKey): { count: number; bytes: number };
  deleteInstall(install: InstallKey): void; // uninstall with "Keep its data?" = No (spec 12 §3)
  onChange(listener: (key: DocKey, value: Json, revision: number) => void): () => void;
};
```

Main resolves `DocAddress` (spec 07 §2) to a `DocKey`: `global` → `account: ""`; `account` → the `accountId` of the window
that holds that `sid` (unknown or closed `sid`: spec 07 rule 3). The schema checks `name` with the spec 08 §3.5 rule and
`expectedRevision` as an integer ≥ 0. Reads take a token from the install's read bucket (capacity and refill
`docs.readsPerSecond`, cost 1); without one the read is refused `rate` (reply shape: spec 07 §3) and counts `doc-refused`.

### 3.3 Write and changes

`write` runs these steps in order. The first that fails gives the reply.

| Step | Check | Reply |
| --- | --- | --- |
| 1 | `text = JSON.stringify(value)`; `bytes = Buffer.byteLength(text)` > `docs.docBytes` | `quota` |
| 2 | the write bucket (capacity and refill `docs.writesPerSecond`, cost 1) and byte bucket (capacity and refill `docs.writeBytesPerSecond`, cost `bytes`) both pass; tokens are taken only when both pass | `rate` |
| 3 | `BEGIN IMMEDIATE`; stored revision (0 when absent) ≠ `expectedRevision` | `conflict` with the stored value; `ROLLBACK` |
| 4 | a new document and the install already has `docs.count` documents; or install total − old `bytes` + `bytes` > `docs.totalBytes` (all scopes and accounts) | `quota`; `ROLLBACK` |
| 5 | upsert with `revision + 1`; `COMMIT` | `{ ok: true, revision }` |

Each `quota` and `rate` reply counts `doc-refused` (§7). Coalescing (`docs.coalesceMs`) is the membrane's (spec 07 §8); Main
repeats every check, whatever the membrane did. Changes: after a successful write Main sends `plugin.doc.changed` (spec 07 §4) to the install's plugin host, only if it runs. `sids`:
`global` → every open session (the writer's too, since a `global` address carries no `sid`; the runtime drops a change whose
revision is not newer, spec 06); `account` → the open sessions whose window has that `accountId`, minus the writer's `sid`; no event when `sids` is empty.

## 4. Net proxy (HTTPS)

### 4.1 URL rules

```ts
// packages/sdk/src/host/urls.ts
export type UrlCheck = { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: "form" | "host" }; // form: rules 1-4; host: rule 5
export function grantedUrl(input: string, scheme: "https:" | "wss:", hosts: ReadonlySet<string>): UrlCheck;
```

`hosts` are the install's effective `net:` hosts (`wss:`, fetches) or `link:` hosts (`plugin.link.open`, `Link.href`, spec 09).
In order:

1. `new URL(input)` throws, `protocol` ≠ `scheme`, or `username` or `password` not empty → refused.
2. `hostname` starts with `[` or matches `^\d{1,3}(\.\d{1,3}){3}$` (WHATWG turns every IPv4 spelling into this form) → refused.
3. `port` ≠ `""` (WHATWG empties 443 for these schemes) → refused.
4. `hostname` ends with `.` → refused, never normalized.
5. `hostname` (lowercase, IDNA to ASCII by WHATWG) not in `hosts` → refused.

Mixed case passes; a punycode lookalike fails rule 5. The request sends `pathname + search`. Every redirect hop obeys the
same rules with `hosts` = the request's own host only.

### 4.2 Addresses

Port the probe code (`probes/PB11/src/net-core.mjs` on branch `probe/PB11`) closely, with tests:

- Resolve once per request or connect attempt with `dns.promises.lookup(host, { all: true, verbatim: true })`, raced
  against the deadline; redirect hops reuse the answers.
- Refuse the host when any answer is not public. IPv4 refused ranges: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`,
  `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`,
  `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`. IPv6: only `2000::/3`, minus
  `2001::/32`, `2001:2::/48`, `2001:db8::/32`, `2002::/16`, `3fff::/20`; any address with a zone id (`%`) is refused. Use `node:net` `BlockList`.
- Connect only to vetted answers through a pinned `lookup` that refuses other names; SNI and certificate name = host.

### 4.3 Request and response

- `https.request({ host, port: 443, path, method: "GET", agent, lookup, signal, headers })` with `agent = new
  https.Agent({ keepAlive: false, maxCachedSessions: 0, ca })`, one per request, destroyed after it. `ca =
  tls.getCACertificates("bundled")`. Never global `fetch`, never the default agent.
- Headers: `accept: application/json, text/*` and `user-agent: Moxi/<app version>` only. No `cookie`, `if-none-match`,
  `authorization` or `referer`; `set-cookie` is ignored.
- One deadline `net.timeoutMs` for DNS, connect, redirects and body (`AbortSignal.timeout`).
- 3xx with `location`: the target must pass §4.1 for the same host; at most `net.redirects` hops.
- 2xx only. Media type (before `;`) must match `^(text\/[\w.+-]+|application\/(json|[\w.+-]+\+json))$` (case-insensitive),
  and `content-encoding` must be absent or `identity`.
- `content-length` or the streamed body above `net.responseBytes` stops the read. Settle first, then `res.destroy()`.
- Decode the body as UTF-8 whatever the charset.

```ts
// packages/sdk/src/host/data.ts — plugin.net.data and the worker `net` message (spec 07)
export type FetchResult = { readonly ok: true; readonly text: string; readonly type: string; readonly at: EpochMs }
  | { readonly ok: false; readonly error: NetError }; // NetError, NetErrorKind: spec 08 §3.9
// type: media type without parameters, lowercase (the worker parses JSON types, spec 08 §3.9); at: response received.
```

### 4.4 Errors

Main produces every `NetError` except `parse` (the worker's). `message` is host text with the host name.

| Condition | `kind` | `message` |
| --- | --- | --- |
| `grantedUrl` gives `form` | `not-permitted` | "This address is not allowed" |
| `grantedUrl` gives `host`; the grant is off or revoked | `not-permitted` | "<host> is not allowed for this plugin" |
| bucket empty; `net.inFlight` requests running; a feed over `feed.perInstall` | `rate` | "Too many requests. Try again in a moment" |
| DNS error or no answer; connection error | `offline` | "Can't reach <host>" |
| TLS or certificate error | `offline` | "Can't open a secure connection to <host>" |
| an answer is not public | `address` | "<host> points to a private network address" |
| deadline | `timeout` | "<host> did not answer in time" |
| a redirect target fails §4.1 | `redirect` | "<host> redirected to an address that is not allowed" |
| more than `net.redirects` redirects | `redirect` | "<host> redirected too often" |
| another non-2xx answer (3xx without `location` included) | `status` | "<host> answered with error <status>" |
| media type or encoding refused | `content-type` | "<host> sent something other than text or JSON" |
| body over `net.responseBytes` | `too-large` | "The answer from <host> is too large" |

### 4.5 Subscriptions, polling and cache

```ts
// apps/desktop/src/plugins/net.ts
export type NetDeps = {
  now: () => number; userAgent: string;
  resolve: (host: string) => Promise<string[]>; // tests inject a resolver
  ca: readonly string[];                         // tests inject a test CA
  hosts: (install: InstallKey) => ReadonlySet<string>;              // effective net: hosts
  send: (install: InstallKey, url: string, result: FetchResult) => void; // plugin.net.data; dropped while the host is down
  count: (install: InstallKey, kind: ActivityKind, target: string) => void;
};
export function createNet(deps: NetDeps): {
  subscribe(install: InstallKey, sid: Sid, url: string, every: number | null): { ok: true } | { ok: false; error: NetError };
  unsubscribe(install: InstallKey, sid: Sid, url: string): void;
  refresh(install: InstallKey, url: string): Promise<{ ok: true } | { ok: false; error: NetError }>;
  closeSession(sid: Sid): void;            // session closed or its window gone
  closeInstall(install: InstallKey): void; // disabled, updated, uninstalled, or host restart (spec 03 §1.7)
  regrant(install: InstallKey): void;      // effective grants changed
  close(): void;                           // app quit
};
```

One **entry** per (install, exact URL string): its subscribers (`sid` → `every`), the last result, and one poll timer. Rate
limits are per install; the cache is per (install, URL). Every result goes to `send` once per install; the runtime updates
every session (spec 06 §6).

- `subscribe`: §4.1 fails → the error, nothing stored. Else add the `sid`. If the entry has a result, `send` it at once.
  If the result is not fresh and no request runs, request now.
- Poll interval = `max(smallest every of the subscribers, net.pollFloorMs)`; no poll when every subscriber has
  `every: null`. A poll whose result is still fresh sends nothing.
- Fresh = `cache-control` has `max-age=N` and neither `no-store` nor `no-cache`, and less than N s passed since `at`.
  Errors are never fresh.
- `refresh`: fresh → `send` the stored result again; a request running → it serves this call; else request now. A `rate`
  refusal is the reply and sends nothing.
- Each request takes a token from the install's bucket (capacity `net.burst`, refill `net.requestsPerMinute / 60` per
  second) and a slot of `net.inFlight` (HTTPS only). A poll without a token or slot waits for the next interval and counts
  `request-refused`; only an entry with no result yet gets the `rate` error sent.
- The stored results of one install hold at most `net.cacheBytes` (UTF-8 bytes of `text`); the oldest leaves first. A
  later subscriber then causes a new request.
- `unsubscribe` and `closeSession` remove `sid`s; an entry without subscribers stops polling and keeps its result until
  evicted. `closeInstall` drops the install's entries without events. `regrant`: entries whose host is no longer granted
  stop and `send` a `not-permitted` error.

### 4.6 Links

`plugin.link.open` (spec 07 §3) from a game renderer, after a trusted press (spec 01 §2):

- `{ url }`: `grantedUrl(url, "https:", linkHosts(install))` must pass, else `invalid` (`form`) or `not-permitted` (`host`).
  `{ wiki }`: `wikiUrl` (§6.4); `null` → `invalid`. Then `shell.openExternal`; each opened link counts `link` with the host.

## 5. Feeds (WSS)

```ts
// apps/desktop/src/plugins/feeds.ts
export function createFeeds(deps: Omit<NetDeps, "send"> & {
  message: (install: InstallKey, url: string, data: string) => void;    // plugin.feed.message
  status: (install: InstallKey, url: string, status: FeedStatus) => void; // plugin.feed.status; FeedStatus: spec 08 §3.9
}): {
  open(install: InstallKey, sid: Sid, url: string): { ok: true } | { ok: false; error: NetError };
  close(install: InstallKey, sid: Sid, url: string): void;
  closeSession(sid: Sid): void; closeInstall(install: InstallKey): void;
  regrant(install: InstallKey): void; closeAll(): void;
};
```

- One socket per (install, exact URL) for the whole app, whatever the sessions and windows. `open`: §4.1 with `wss:` fails
  → `not-permitted`; beyond `feed.perInstall` distinct URLs → `rate`. Else add the `sid`, send the status (the first `open` starts the socket).
- Connect: §4.2 resolve and vet with the `net.timeoutMs` deadline, then `new WebSocket(url, { agent, lookup, maxPayload:
  budgets.feed.messageBytes, perMessageDeflate: false, followRedirects: false, handshakeTimeout: <rest of the deadline>,
  headers: { "user-agent": userAgent } })` from `ws` 8.22.0, with the §4.3 `agent`, `ca` and pinned `lookup`. No `origin`,
  no cookies. The client never sends data frames.
- Status: `connecting` for the first attempt, `open` on open, `reconnecting` after any failure, close or unexpected HTTP
  answer, `not-permitted` after a revoke (the socket closes with 1000). Reconnect waits
  `min(feed.backoffMinMs × 2^n, feed.backoffMaxMs)`, n = failures since the last reset; a socket open for
  `feed.backoffResetMs` resets n to 0.
- Ping every `feed.pingMs`; no pong within `feed.pongMs` → `terminate()` and reconnect. A message above
  `feed.messageBytes` closes the socket with 1009 (`ws` does it) and reconnects.
- Text messages pass the install's bucket (capacity and refill `feed.messagesPerSecond`) and go to `message` once per
  install. Binary messages and messages without a token are dropped and count `feed-dropped`.
- The last `close` of a URL closes its socket (1000). `closeSession`, `closeInstall` and `regrant` work as in §4.5. `ws` is a
  new pure-JavaScript dependency (PB11); never install `bufferutil` or `utf-8-validate`. Add `ws` to `desktopImports`
  (`vite.config.ts:40`) and Main's `alwaysBundle` (`apps/desktop/vite.config.ts:11`).

## 6. Reference data

### 6.1 Tables and loading

- Rows: `RefRows` (spec 08 §3.8); fields only host elements need (`SkillCard` costs and descriptions, spec 09) join it
  additively in the slice that sources them. Main holds
  `type ReferenceTables = { readonly [K in RefTable]: readonly RefRows[K][] }` (`reference.ts`).
- Sources (BD14): M11-01 picks the source of each table (v1 data, the player's `Gw.dat`) and records it here. Limits:
  English names; game ids; data shipped in the app only with a licence that allows it and a line in
  `THIRD-PARTY-NOTICES.md` (v1 map names come from GWCA constants, MIT, `gwonmac/src/shared/guild-wars-map-names.ts:1-5`);
  data read from `Gw.dat` goes to a rebuildable cache and is decoded off Main's thread.
- Main loads the tables once, on the first query or `ref.get`, without blocking its thread. A load failure logs once and
  serves empty tables (labels fall back, spec 04 `RefNames`). Before M11-01 the test kit and `pnpm hub` use spec 08 §4.4's
  fixtures.

### 6.2 Queries

`plugin.ref.query { install, table, query: RefQuery }` (spec 07 §3; `RefQuery`, `RefSearch`: spec 08 §3.8).

- The request schema is a union per table: an `ids` entry of the table's id type (`Profession` for `professions`, a
  positive integer otherwise), 1 to `reference.pageRows` ids; `limit` 1 to `reference.pageRows`; `filter` keys only those
  of that table's `RefSearch`, which includes `offset` (integer ≥ 0; `limit` inside `filter` is ignored). Anything else is
  malformed.
- Each request takes a token from the install's bucket (capacity and refill `reference.queriesPerSecond`); without one:
  `{ ok: false, reason: "rate" }` and `ref-refused`.
- `ids`: the known rows in the order asked, each id once; unknown ids are left out.
- `text`: normalize = `normalize("NFKD")`, drop `\p{M}`, lowercase, every run of characters outside `[a-z0-9]` becomes one
  space, trim. A row matches when each word of the text is a prefix of a word of its normalized `name`; empty text matches
  every row. The filter applies first. Order: normalized name equal to the text, then names that start with the text, then
  the rest; inside each group by normalized name (code-unit order), then by id. `offset` skips that many rows of this
  order before `limit` applies. Main keeps the normalized names from load time.

### 6.3 Host access

- `ref.get { table, ids }` (game renderer, spec 07 §3) returns the known rows, with no plugin budget; the game renderer
  builds `RefNames` (spec 04) from it.
- Inside Main, `reference.ts` exports `names(): RefNames` and
  `row<K extends RefTable>(table: K, id: RefRows[K]["id"]): RefRows[K] | undefined`, both synchronous and `undefined` before
  the load. Users: action-log labels (spec 12 §6.5) and the QA allowlist (spec 13 §6.2).

### 6.4 Wiki links

```ts
// packages/sdk/src/host/urls.ts
export function wikiUrl(ref: WikiRef, names: RefNames): string | null; // WikiRef: spec 08 §3.7
```

| `WikiRef` | URL |
| --- | --- |
| `{ skill: id }` | `https://wiki.guildwars.com/wiki/Game_link:Skill_<id>` (v1 rule, `gwonmac/src/shared/elite-wiki.ts:15`); needs no name |
| `{ map: id }`, `{ item: id }` | `https://wiki.guildwars.com/wiki/` + `encodeURIComponent(name.replaceAll(" ", "_"))` with the English name; `null` when unknown |
| `{ profession: p }` | the same with `p` capitalized (`warrior` → `Warrior`) |

`id` must be a positive integer, else `null`. The only host is `wiki.guildwars.com`.

### 6.5 Game art

- Host components load `GameArtRef` art (spec 04 §9, spec 09 §5.4) from `moxi://app/ref/skills/<id>.png`,
  `/ref/items/<id>.png`, `/ref/maps/<id>.png` and `/ref/professions/<profession>.png`.
- Main's `moxi` handler serves `/ref/` for the launcher session and the account partitions only. Plugin partitions serve
  `/plugin-host/*` only (spec 03 §1.12), so a plugin gets 404 (P59).
- Any other path, or missing art: 404, and the host draws its glyph. Answers carry `content-type: image/png` and
  `x-content-type-options: nosniff`.
- M12-01 produces the PNGs from `Gw.dat` into a rebuildable cache (spec 16) and chooses the map picture. Until then every
  `/ref/` path is 404.

## 7. Activity

### 7.1 Day counts

Rows of `plugin_activity` (spec 12 §3): one per (install, local day `YYYY-MM-DD`, kind, target).

| Kind | Target | Counted when | Writer |
| --- | --- | --- | --- |
| `request` / `request-failed` | host | an HTTPS request is sent (polls included, fresh cache hits not) / a sent request ends with a `NetError` | §4 |
| `request-refused` | host, or `""` when the URL has none | refused before sending (`rate`, `not-permitted`) | §4, §5 |
| `feed-open` / `feed-message` / `feed-dropped` | host | a socket opened / a message forwarded / a message dropped | §5 |
| `link` | host | a link or wiki page opened | §4.6 |
| `note` / `note-dropped` | `""` | a note sent / dropped | spec 13 §9 |
| `doc-refused` | `quota` or `rate` | a document read or write refused | §3 |
| `ref-refused` | `rate` | a reference query refused | §6.2 |
| `action` | op id | a step reported `done` or `failed` | spec 13 §6 |
| `action-refused` | `Refusal` | Main refused, or a step reported `refused` | spec 13 §6 |
| `crash` | the stored crash kind (`CrashKind`, spec 07 `host/port.ts`; policy: spec 03) | `plugin.crashed` (spec 03 §1.8) | spec 03 |
| `host-crashed`, `host-memory`, `host-cpu-high`, `host-paused`, `sandbox-refused` | `HostKey` | the host event (spec 03), once for each install bound to that host | spec 03 |

### 7.2 Service and read model

```ts
// packages/contracts/src/activity.ts
export type ActivityKind = "request" | "request-failed" | "request-refused" | "feed-open" | "feed-message"
  | "feed-dropped" | "link" | "note" | "note-dropped" | "doc-refused" | "ref-refused" | "action"
  | "action-refused" | "crash" | HostEventKind; // the §7.1 rows; HostEventKind: spec 03 §2
export type Activity = {
  readonly counts: readonly { readonly day: string; readonly kind: ActivityKind; readonly target: string; readonly count: number }[];
  // newest day first, then kind and target in code-unit order
  readonly actions: readonly ActionLogEntry[]; // spec 12 §6.5; newest first, at most budgets.activity.actions
  readonly documents: { readonly count: number; readonly bytes: number }; // §3.2 usage
};

// apps/desktop/src/plugins/activity.ts
export function createActivity(deps: { db: Database; now: () => number }): {
  count(install: InstallKey, kind: ActivityKind, target: string): void;
  flush(): void;                       // buffered counts, one transaction
  read(install: InstallKey): Activity; // flushes first; answers plugins.activity (spec 07 §3)
};
```

- `count` adds 1 to an in-memory map keyed by (install, local day of `now()`, kind, target). `flush` upserts `count =
  count + excluded.count` every `activity.flushMs` (spec 05; a Main schedule, not a plugin budget)
  while counts wait, before `read`, and at quit.
- `read` returns the last `activity.days` days. A flush that wrote rows sends `plugins.changed` (spec 07 §4), at most once
  per flush.
- Action log rows, their 30-day prune and uninstall deletes are spec 12's (§3, §6.5); this service only reads them.
  `RequestAccess` deny counts are grant data (spec 12), not activity.

## 8. Signed feed keys

`fetchSigned` and the feed formats are spec 15's. Its keys:

- The compat feed and the plugin index each pin their own two ed25519 public keys, `current` and `next`, as constants in
  `apps/desktop/src/feeds.ts`; either key of a feed signs a valid file. No key serves both feeds. A key id is the first 16
  hex characters of SHA-256 over the 32 raw public-key bytes; logs and errors name keys by id.
- Rotation: a release adds the new key as `next`; signing moves to it; a later release makes it `current` and adds a new
  `next`. Creating and holding the keys is Matthias's (M9-11, M14-01).

## 9. Decisions

| Decision | Reason | Rejected |
| --- | --- | --- |
| Old rows move to `official/<id>`; a conflict returns stored value and revision | all belong to bundled plugins; merge without a second read | dropping them; revision only |
| `https.request`, pinned lookup, fresh `Agent`; `ws` 8.22.0 with the same lookup (PB11) | no rebinding window, proxy leak or session reuse; maintained framing | global `fetch`, `net.fetch`, `WebSocket` (cannot pin); own frame reader |
| Bundled roots only; trailing-dot hosts refused; `max-age` cache in memory; binary frames dropped; skill links by `Game_link:Skill_<id>` | one trust and one spelling; no identifier survives a run; v1-proven | system roots, normalizing, ETags, cookies, disk cache, name URLs |
| One entry per (install, URL); Main sends text and media type, the worker parses | four windows, one request and socket; untrusted JSON stays in the worker (spec 08) | per session or window; `JSON.parse` in Main |
| Reference queries in Main; prefix-word matching, fixed ranks | one copy of the tables; predictable for "ka", "heal" | whole tables per worker; fuzzy scores |
| Activity counts buffered; per-feed key pairs | 50 feed messages per second must not mean 50 writes; a leaked key cannot sign the other feed | write per event; one key pair |

## 10. Today in code (main 848fb6e) and what changes

- `apps/desktop/src/storage/documents.ts:12-70`, migration 1 `storage/migrations.ts:3-16`, tests
  `storage/storage.test.ts:170-205` and `plugin-documents.test.ts`: become `plugins/documents.ts` and
  `plugins/documents.test.ts` with the P58 rows; the `docs` export leaves `storage/index.ts` (M4-03).
- `apps/desktop/src/plugin-documents.ts` (used by `apps/plugin-host/src/plugin-host.test.ts:6`): deleted; the host test
  moves with the membrane (M4-09).
- `apps/desktop/src/shell/main.ts:313-321`: broadcast handlers become install-bound, §3.3 change events (today's broadcast
  to every plugin host ends). Net proxy, feeds, `ws`, reference data, `/ref/` and activity do not exist yet.
- `packages/contracts/src/documents.ts` (`documentRef`, `documentWriteResult`): `DocAddress` (spec 07), `DocWriteReply`
  (M4-01, M4-03).
- `apps/desktop/src/game-files/transport.ts:14-29` (8 download slots): unchanged; plugin traffic never uses it.
  `apps/game/src/hub/Icon.vue` (letter tiles): §6.5 art, glyph fallback (M3-03, M12-01).

## 11. Built by and checked by

| Slice | Builds | Proofs (all Gate; N = node, E = end to end) |
| --- | --- | --- |
| M4-03 | §3: migration, `createDocuments`, `DocWriteReply`, change routing | P58 (N): two concurrent writes (second gets `conflict` with the stored value); quota; the same plugin id from `gh:` and `community` reads nothing of the other; uninstall keep and delete |
| M4-07 | §7: `createActivity`, `plugins.activity`, counts from the authority | P43 (N): one action-log entry per authorize call, shown in `Activity`; E half in M5-08 |
| M4-08 | P77 document flood and its Measure | P77 (+ Measure, E): over-budget calls get `rate`; Main event-loop delay during document, reference and request floods; M7-01 and M11-01 add rows |
| M7-01 | §4.1 to §4.6: `grantedUrl`, `createNet`, `plugin.net.*`, `plugin.link.open` (injected `RefNames` in tests), request counts; adds the request flood to P77 | P54 (N): `grantedUrl` table: userinfo, trailing dot, punycode lookalike, mixed case, port 8443, IPv4 and IPv6 literals, `http:`, `file:`. P56 HTTPS rows (N): fake clock, 61 requests in a minute, 5 MiB body, 11 s answer, third concurrent request, `ETag` and cookie never sent back, empty cache after a restart |
| M7-02 | §5: `createFeeds`, `plugin.feed.*`, the `ws` dependency | P55 (N): injected resolver and a local TLS server with a test CA: every private answer refused `address`; one lookup; the first vetted address used; a redirect to another host refused; HTTPS and WSS. P56 feed rows (N): 65 KiB message, 51 messages per second. P57 (N + E): four sessions, one request per interval and one socket; backoff 1, 2, 4 s |
| M11-01 | §6.1 to §6.4: tables and sources, `plugin.ref.query`, `ref.get`, `names`, `row`, `wikiUrl` names; adds the reference flood to P77 | |
| M12-01 | §6.5: `/ref/` art | P59 (E): the plugin partition gets 404 for `moxi://app/ref/…`; host components get the art |
| M7-04; M9-11, M14-01 | renders `Activity` on the plugin page (spec 12); §8 for the compat feed and the plugin index | |

## 12. Deferred

System CA roots: only after a real report from a player behind a TLS-inspecting proxy. Localized reference names, and `POST`
or sending on feeds: additive within `api: 1` when a plugin needs them.
