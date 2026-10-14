// PB11 harness: runs the P54, P55 and P56 tables against every candidate stack and writes results.
// usage: node run.mjs [out.json]    (needs openssl on PATH; no network except one example.com smoke GET)
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import tls from 'node:tls'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { basename, dirname, join } from 'node:path'
import { HTTPS, WSS } from './src/candidates.mjs'
import { fetchText } from './src/https-fetch.mjs'
import { NetError, parseGrantedUrl, pinnedLookup, systemResolve, vetAddress } from './src/net-core.mjs'
import { fixtureVet, scriptedResolver, startFixture, waitFor } from './test/fixture.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = process.env.PB11_OUT ?? process.argv[2] ?? join(here, 'results.local.json')
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e))

const rows = []
const row = (cand, table, name, pass, detail = '', extra = {}) => {
  if (pass !== null) pass = Boolean(pass)
  rows.push({ cand, table, name, pass, detail, ...extra })
  console.log(`${pass === true ? 'PASS' : pass === false ? 'FAIL' : 'N/A '} ${cand} ${table} ${name}${detail ? ` | ${detail}` : ''}`)
}
const caught = async (p) => { try { await p; return null } catch (e) { return e } }
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] }
const round = (n) => Math.round(n * 100) / 100

const fx = await startFixture()
const HOST = 'granted.test'
const url = (path, host = HOST) => `https://${host}:${fx.port}${path}`
const wss = (path, host = HOST) => `wss://${host}:${fx.port}${path}`
const cfg = (resolve, extra = {}) => ({ host: HOST, port: String(fx.port), resolve, vet: fixtureVet(vetAddress), ca: fx.ca, ...extra })

const PRIVATE = ['127.0.0.1', '10.0.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fc00::1', '::ffff:127.0.0.1']
const PRIVATE_EXTRA = ['0.0.0.0', '172.16.0.1', '172.31.255.255', '192.168.1.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
  '::', 'fe80::1', 'ff02::1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2']
const PUBLIC = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e']

// ---------------------------------------------------------------- P54 (candidate independent)
{
  const G = 'granted.test'
  const table = [
    ['https://granted.test/x', 'https:', null], ['https://GRANTED.Test/x', 'https:', null], ['https://granted.test:443/x', 'https:', null],
    ['wss://granted.test/feed', 'wss:', null],
    ['https://good@granted.test/x', 'https:', 'userinfo'], ['https://granted.test@evil.test/', 'https:', 'userinfo'],
    ['https://evil.test\\@granted.test/', 'https:', 'host'], ['https://granted.test./x', 'https:', 'host'],
    ['https://granted.test%2e/x', 'https:', 'host'], ['https://xn--grnted-9ua.test/x', 'https:', 'host'],
    ['https://grånted.test/x', 'https:', 'host'], ['https://granted.test:8443/x', 'https:', 'port'],
    ['https://127.0.0.1/x', 'https:', 'literal'], ['https://[::1]/x', 'https:', 'literal'], ['https://2130706433/x', 'https:', 'literal'],
    ['https://0x7f.1/x', 'https:', 'literal'], ['http://granted.test/x', 'https:', 'scheme'], ['file:///etc/passwd', 'https:', 'scheme'],
    ['ws://granted.test/feed', 'wss:', 'scheme'], ['https://granted.test/feed', 'wss:', 'scheme'], ['not a url', 'https:', 'url'],
    ['https://sub.granted.test/x', 'https:', 'host'], ['https://granted.test.evil.test/x', 'https:', 'host'],
  ]
  const bad = []
  for (const [input, scheme, want] of table) {
    let got = null
    try { parseGrantedUrl(input, scheme, G) } catch (e) { got = e.reason }
    if (got !== want) bad.push(`${input} -> ${got} (want ${want})`)
  }
  row('shared', 'P54', `URL table (${table.length} rows)`, bad.length === 0, bad.join('; '))
}

// ---------------------------------------------------------------- P55 pure vetting table
{
  const bad = []
  for (const ip of [...PRIVATE, ...PRIVATE_EXTRA]) if (!vetAddress(ip)) bad.push(`${ip} allowed`)
  for (const ip of PUBLIC) if (vetAddress(ip)) bad.push(`${ip} refused`)
  for (const junk of ['127.1', '0x7f000001', 'localhost', '', 'fe80::1%en0']) if (!vetAddress(junk)) bad.push(`${JSON.stringify(junk)} allowed`)
  row('shared', 'P55', `vetAddress table (${PRIVATE.length + PRIVATE_EXTRA.length} refused, ${PUBLIC.length} allowed, 5 junk)`, bad.length === 0, bad.join('; '))
}

{
  const lookup = pinnedLookup('granted.test', ['203.0.113.9', '2606:4700::1111'])
  const call = (host, options) => new Promise((resolve) => lookup(host, options, (...args) => resolve(args)))
  const [e1, a1, f1] = await call('granted.test', { family: 0 })
  const [, all] = await call('granted.test', { all: true, family: 0 })
  const [, v6] = await call('granted.test', { all: true, family: 6 })
  const [, one6, fam6] = await call('granted.test', { family: 6 })
  const [other] = await call('evil.test', { family: 0 })
  const ok = e1 === null && a1 === '203.0.113.9' && f1 === 4 && all.length === 2 && v6.length === 1 && one6 === '2606:4700::1111' && fam6 === 6 && other?.reason === 'address'
  row('shared', 'P55', 'pinnedLookup answers all:true and all:false, honours family, refuses other names', ok, ok ? '' : JSON.stringify({ e1, a1, f1, all, v6, one6, other: other?.message }))
}

// ---------------------------------------------------------------- HTTPS candidates
async function httpsTables(cand, fetchFn, { control = false } = {}) {
  const t = (name, pass, detail, extra) => row(cand, name.startsWith('P56') ? 'P56' : 'P55', name.replace(/^P5\d /, ''), pass, detail, { control, ...extra })

  // private answers
  {
    const bad = []
    for (const ip of [...PRIVATE, ...PRIVATE_EXTRA]) {
      fx.reset()
      const r = scriptedResolver([ip])
      const err = await caught(fetchFn(url('/ok'), cfg(r, { vet: undefined })))
      if (err?.reason !== 'address' || fx.tcp.A + fx.tcp.B !== 0 || r.calls.length !== 1) bad.push(`${ip} -> ${err?.reason ?? 'connected'} tcp=${fx.tcp.A + fx.tcp.B}`)
    }
    t('P55 private answers refused as address, 0 connections', bad.length === 0, bad.join('; '))
  }
  // with the vetter switched off, the table must notice (proves the check can fail)
  if (cand === 'A_https_request') {
    fx.reset()
    const err = await caught(fetchFn(url('/ok'), cfg(scriptedResolver(['127.0.0.1']), { vet: () => null })))
    row(cand, 'P55', 'control: vetter off lets 127.0.0.1 through (table would catch it)', err === null && fx.tcp.A === 1, '', { control: true, expectedPass: true })
  }
  // a resolver that never answers must end at the deadline
  {
    const t0 = performance.now()
    const err = await caught(fetchFn(url('/ok'), cfg(() => new Promise(() => {}), { timeoutMs: 400 })))
    const ms = performance.now() - t0
    t('P56 a resolver that never answers ends as timeout at the deadline', err?.reason === 'timeout' && ms < 1200, `${err?.reason ?? 'finished'} after ${Math.round(ms)} ms`, control ? { expectedPass: false } : {})
  }
  // mixed answer
  {
    fx.reset()
    const err = await caught(fetchFn(url('/ok'), cfg(scriptedResolver(['127.0.0.1', '10.0.0.1']))))
    t('P55 one private answer among public refuses the host', err?.reason === 'address' && fx.tcp.A === 0, err?.reason ?? 'connected')
  }
  // rebinding: public answer, then private
  if (fx.otherIp) {
    fx.reset()
    const r = scriptedResolver(['127.0.0.1'], [fx.otherIp])
    let res, err
    try { res = await fetchFn(url('/ok'), cfg(r)) } catch (e) { err = e }
    const ok = res?.status === 200 && r.calls.length === 1 && fx.tcp.B === 0 && fx.snis.includes(HOST)
    t('P55 rebinding: first vetted address used, 0 second lookups', ok, `status=${res?.status ?? err?.reason} lookups=${r.calls.length} tcpToSecondAnswer=${fx.tcp.B} sni=${fx.snis.join(',')}`, control ? { expectedPass: false } : {})
  } else row(cand, 'P55', 'rebinding', null, 'no second loopback address available on this machine')
  if (control) return // the control only has to lose the rebinding row
  // redirects
  {
    const cases = [
      ['redirect to another host', `/redir?to=${encodeURIComponent(`https://other.test:${fx.port}/ok`)}`, 'redirect', 1],
      ['redirect to http', `/redir?to=${encodeURIComponent(`http://${HOST}:${fx.port}/ok`)}`, 'redirect', 1],
      ['redirect to an IP literal', `/redir?to=${encodeURIComponent(`https://127.0.0.1:${fx.port}/ok`)}`, 'redirect', 1],
      ['redirect with userinfo', `/redir?to=${encodeURIComponent(`https://x@${HOST}:${fx.port}/ok`)}`, 'redirect', 1],
    ]
    const bad = []
    for (const [name, path, want, reqs] of cases) {
      fx.reset()
      const r = scriptedResolver(['127.0.0.1'])
      const err = await caught(fetchFn(url(path), cfg(r)))
      if (err?.reason !== want || fx.requests.length !== reqs) bad.push(`${name}: ${err?.reason ?? 'followed'} requests=${fx.requests.length}`)
    }
    t('P55 off-host, http, literal and userinfo redirects refused', bad.length === 0, bad.join('; '))
    fx.reset()
    const r3 = scriptedResolver(['127.0.0.1'])
    const ok3 = await caught(fetchFn(url('/loop?n=3'), cfg(r3)))
    t('P55 3 same-host redirects followed, 0 extra lookups', ok3 === null && fx.requests.length === 4 && r3.calls.length === 1, `err=${ok3?.reason} requests=${fx.requests.length} lookups=${r3.calls.length}`)
    fx.reset()
    const err4 = await caught(fetchFn(url('/loop?n=4'), cfg(scriptedResolver(['127.0.0.1']))))
    t('P55 4th redirect refused', err4?.reason === 'redirect' && fx.requests.length === 4, `${err4?.reason} requests=${fx.requests.length}`)
  }
  // TLS
  {
    fx.reset()
    const e1 = await caught(fetchFn(url('/ok', 'wrongcert.test'), cfg(scriptedResolver(['127.0.0.1']), { host: 'wrongcert.test' })))
    t('P55 certificate for another name refused as tls (SNI = host)', e1?.reason === 'tls' && fx.snis.includes('wrongcert.test'), `${e1?.reason ?? 'connected'} ${e1?.message ?? ''} sni=${fx.snis.join(',')}`)
    fx.reset()
    const e2 = await caught(fetchFn(url('/ok'), cfg(scriptedResolver(['127.0.0.1']), { ca: undefined })))
    t('P55 chain not rooted in the system/bundled roots refused as tls', e2?.reason === 'tls', `${e2?.reason ?? 'connected'} ${e2?.message ?? ''}`)
  }
  // P56 stack-dependent rows
  {
    const MiB4 = 4 * 2 ** 20
    const bad = []
    for (const mode of ['cl', 'chunked']) {
      const ok = await fetchFn(url(`/size?n=${MiB4}&mode=${mode}`), cfg(scriptedResolver(['127.0.0.1']))).catch((e) => e)
      if (ok.text?.length !== MiB4) bad.push(`4 MiB ${mode}: ${ok.reason ?? ok.text?.length}`)
      for (const n of [MiB4 + 1, 5 * 2 ** 20]) {
        const err = await caught(fetchFn(url(`/size?n=${n}&mode=${mode}`), cfg(scriptedResolver(['127.0.0.1']))))
        if (err?.reason !== 'size') bad.push(`${n} ${mode}: ${err?.reason ?? 'accepted'}`)
      }
    }
    t('P56 4 MiB passes, 4 MiB+1 and 5 MiB refused as size (content-length and chunked)', bad.length === 0, bad.join('; '))
  }
  {
    const bad = []
    for (const path of ['/slow?ms=1500', '/trickle?ms=1500']) {
      const t0 = performance.now()
      const err = await caught(fetchFn(url(path), cfg(scriptedResolver(['127.0.0.1']), { timeoutMs: 400 })))
      const ms = performance.now() - t0
      if (err?.reason !== 'timeout' || ms > 1200) bad.push(`${path}: ${err?.reason ?? 'finished'} after ${Math.round(ms)} ms`)
    }
    t('P56 total deadline refuses a slow response and a trickle as timeout (400 ms scaled for 10 s)', bad.length === 0, bad.join('; '))
  }
  {
    const want = { '/type': 'type', '/gz': 'type', '/boom': 'status' }
    const bad = []
    for (const [path, reason] of Object.entries(want)) {
      const err = await caught(fetchFn(url(path), cfg(scriptedResolver(['127.0.0.1']))))
      if (err?.reason !== reason) bad.push(`${path}: ${err?.reason ?? 'accepted'}`)
    }
    t('P56 octet-stream, gzip and 500 refused with typed reasons', bad.length === 0, bad.join('; '))
  }
  {
    fx.reset()
    await fetchFn(url('/ok'), cfg(scriptedResolver(['127.0.0.1'])))
    await fetchFn(url('/ok'), cfg(scriptedResolver(['127.0.0.1'])))
    await fetchFn(url('/hdrs'), cfg(scriptedResolver(['127.0.0.1'])))
    const names = Object.keys(fx.requests[2].headers).sort().join(',')
    const leaked = fx.requests.slice(1).some((r) => ['cookie', 'if-none-match', 'if-modified-since', 'referer', 'authorization'].some((h) => h in r.headers))
    const resumed = fx.requests.some((r) => r.reused)
    t('P56 only accept, user-agent, host, connection sent; no cookie/etag replay; no TLS ticket reuse', names === 'accept,connection,host,user-agent' && !leaked && !resumed, `headers=${names} leaked=${leaked} tlsSessionReused=${resumed}`)
  }
  // latency
  {
    const lat = []
    const r = scriptedResolver(['127.0.0.1'])
    for (let i = 0; i < 110; i++) {
      const t0 = performance.now()
      await fetchFn(url('/ok'), cfg(r))
      if (i >= 10) lat.push(performance.now() - t0)
    }
    row(cand, 'latency', 'GET /ok, new TLS connection each, 100 runs after 10 warm-up', null, '', { metric: 'ms', p50: round(pct(lat, 50)), p95: round(pct(lat, 95)), max: round(Math.max(...lat)) })
  }
}

// ---------------------------------------------------------------- WSS candidates
async function open(openFn, path, config, host = HOST) {
  const events = []
  const on = { message: (d, binary) => events.push({ t: 'message', d, binary }), close: (c, r) => events.push({ t: 'close', c, r }), pong: (p) => events.push({ t: 'pong', p }) }
  try {
    return { events, handle: await openFn(wss(path, host), config, on) }
  } catch (error) {
    return { events, error }
  }
}
const closeEvent = (s) => s.events.find((e) => e.t === 'close')
const messages = (s) => s.events.filter((e) => e.t === 'message')
const sizeOf = (d) => (typeof d === 'string' ? Buffer.byteLength(d) : (d.byteLength ?? d.length))

const toBuf = (d) => (typeof d === 'string' ? Buffer.from(d) : d instanceof ArrayBuffer ? Buffer.from(d) : Buffer.from(d.buffer, d.byteOffset, d.byteLength))

async function wsTables(cand, openFn) {
  const t = (name, pass, detail, extra) => row(cand, name.startsWith('P56') ? 'P56' : name.startsWith('P55') ? 'P55' : 'WS', name.replace(/^P5\d /, ''), pass, detail, extra)
  const good = (resolve = scriptedResolver(['127.0.0.1']), extra = {}) => cfg(resolve, { maxMessage: 64 * 1024, ...extra })

  const privateRefused = async () => {
    const bad = []
    for (const ip of [...PRIVATE, ...PRIVATE_EXTRA]) {
      fx.reset()
      const r = scriptedResolver([ip])
      const s = await open(openFn, '/feed?case=hello', good(r, { vet: undefined }))
      if (s.error?.reason !== 'address' || fx.tcp.A + fx.tcp.B !== 0 || r.calls.length !== 1) bad.push(`${ip} -> ${s.error?.reason ?? 'connected'}`)
    }
    t('P55 private answers refused as address, 0 connections', bad.length === 0, bad.join('; '))
  }
  const rebinding = async () => {
    if (!fx.otherIp) return row(cand, 'P55', 'rebinding', null, 'no second loopback address available on this machine')
    fx.reset()
    const r = scriptedResolver(['127.0.0.1'], [fx.otherIp])
    const s = await open(openFn, '/feed?case=hello', good(r))
    await waitFor(() => messages(s).length >= 1 || s.error, 2000)
    const ok = !s.error && messages(s).length === 1 && r.calls.length === 1 && fx.tcp.B === 0 && fx.upgrades[0]?.servername === HOST
    t('P55 rebinding: first vetted address used, 0 second lookups', ok, `${s.error ? `${s.error.reason}: ${s.error.message}` : 'connected'} lookups=${r.calls.length} tcpToSecondAnswer=${fx.tcp.B} sni=${fx.upgrades[0]?.servername}`)
    s.handle?.close?.()
  }

  if (cand === 'W1_global_plain') {
    // No option of `new WebSocket(url, init)` names an address, a lookup or a CA; the runtime resolves the name itself.
    await privateRefused()
    await rebinding()
    if (typeof WebSocket === 'undefined') return row(cand, 'WS', 'global WebSocket exists in this runtime', false, 'typeof WebSocket is undefined')
    const system = await import('node:dns/promises').then((d) => d.lookup(HOST).then(() => 'resolves', () => 'ENOTFOUND'))
    const attempts = {}
    for (const [label, init] of [['lookup', { lookup: () => {} }], ['agent', { agent: {} }], ['connect.lookup', { connect: { lookup: () => {} } }], ['ca', { ca: fx.ca }]]) {
      attempts[label] = await new Promise((resolve) => {
        const ws = new WebSocket(wss('/feed?case=hello'), init)
        const t = setTimeout(() => resolve('timeout'), 2500)
        ws.addEventListener('open', () => { clearTimeout(t); ws.close(); resolve('open') })
        ws.addEventListener('error', () => { clearTimeout(t); resolve('error') })
      })
    }
    const opened = Object.entries(attempts).filter(([, v]) => v === 'open').map(([k]) => k)
    t('WS init options lookup, agent, connect.lookup, ca can pin an address or trust a CA', system === 'ENOTFOUND' ? opened.length > 0 : null, `system DNS for ${HOST}: ${system}; outcomes ${JSON.stringify(attempts)}`)
    return
  }

  // basic path
  {
    fx.reset()
    const s = await open(openFn, '/feed?case=msgs', good())
    await waitFor(() => messages(s).length >= 3)
    const m = messages(s)
    const okMsgs = m.length === 3 && m[0].d === 'one' && m[2].d === 'three' && m[1].binary && toBuf(m[1].d).equals(Buffer.from([1, 2, 3]))
    t('WS text, binary and text messages arrive in order; SNI = host; TLS verified with the test CA', !s.error && okMsgs && fx.upgrades[0]?.servername === HOST, `${s.error?.message ?? ''} sni=${fx.upgrades[0]?.servername}`)
    s.handle?.close?.()
  }
  {
    fx.reset()
    const bad = await open(openFn, '/feed?case=badaccept', good())
    t('WS handshake answer with a wrong Sec-WebSocket-Accept refused', !!bad.error && messages(bad).length === 0, `${bad.error?.reason ?? 'opened'}`)
    bad.handle?.close?.()
    fx.reset()
    const ext = await open(openFn, '/feed?case=ext', good())
    if (cand === 'W1b_global_dispatcher') row(cand, 'WS', 'handshake answer with an extension nobody asked for refused', null, 'not applicable: undici offers permessage-deflate itself (so it also carries a decompression surface)')
    else t('WS handshake answer with an extension nobody asked for refused', !!ext.error && messages(ext).length === 0, `${ext.error?.reason ?? 'opened'}`)
    ext.handle?.close?.()
  }
  await privateRefused()
  await rebinding()
  {
    const t0 = performance.now()
    const stuck = await open(openFn, '/feed?case=hello', good(() => new Promise(() => {}), { handshakeMs: 400 }))
    const ms = performance.now() - t0
    t('P56 a resolver that never answers ends as timeout at the deadline', stuck.error?.reason === 'timeout' && ms < 1200, `${stuck.error?.reason ?? 'finished'} after ${Math.round(ms)} ms`)
  }
  // redirect and TLS: refused (P55) and told apart (P56 typed reasons)
  {
    fx.reset()
    const red = await open(openFn, '/ws302', good())
    t('P55 redirect on the upgrade refused; no second connection', !!red.error && fx.upgrades.length === 1 && fx.tcp.A === 1, `${red.error?.reason ?? 'followed'} upgrades=${fx.upgrades.length}`)
    fx.reset()
    const name = await open(openFn, '/feed', good(scriptedResolver(['127.0.0.1']), { host: 'wrongcert.test' }), 'wrongcert.test')
    t('P55 certificate for another name refused; SNI = host', !!name.error && fx.snis.includes('wrongcert.test') && fx.upgrades.length === 0, `${name.error?.reason ?? 'connected'} ${name.error?.message ?? ''} sni=${fx.snis.join(',')}`)
    fx.reset()
    const root = await open(openFn, '/feed', good(scriptedResolver(['127.0.0.1']), { ca: undefined }))
    t('P55 chain not rooted in the roots refused', !!root.error && fx.upgrades.length === 0, `${root.error?.reason ?? 'connected'} ${root.error?.message ?? ''}`)
    const reasons = { redirect: red.error?.reason, wrongName: name.error?.reason, untrustedRoot: root.error?.reason }
    t('P56 refusals carry typed reasons: redirect, tls, tls', reasons.redirect === 'redirect' && reasons.wrongName === 'tls' && reasons.untrustedRoot === 'tls', JSON.stringify(reasons))
    for (const x of [red, name, root]) x.handle?.close?.()
  }
  // size caps
  {
    const one = async (path) => {
      fx.reset()
      const s = await open(openFn, path, good())
      await waitFor(() => messages(s).length >= 1 || closeEvent(s), 3000)
      const out = { delivered: messages(s).map((m) => sizeOf(m.d)), close: closeEvent(s)?.c, error: s.error?.message }
      s.handle?.close?.()
      return out
    }
    const a = await one('/feed?case=size&n=65536')
    t('P56 a 64 KiB message is delivered', a.delivered.length === 1 && a.delivered[0] === 65536, JSON.stringify(a))
    const b = await one('/feed?case=size&n=65537')
    t('P56 a 64 KiB+1 message is not delivered; connection closed', b.delivered.length === 0 && b.close !== undefined, JSON.stringify(b))
    const c = await one('/feed?case=frag&n=70000&parts=7')
    t('P56 a fragmented 70000 byte message is not delivered; connection closed', c.delivered.length === 0 && c.close !== undefined, JSON.stringify(c))
    fx.reset()
    const t0 = performance.now()
    const h = await open(openFn, '/feed?case=claimhuge', good())
    const closed = await waitFor(() => closeEvent(h), 3000)
    const ms = Math.round(performance.now() - t0)
    t('P56 a frame header claiming 1 GiB closes the connection within 3 s without waiting for the data', closed && messages(h).length === 0, `closed=${closed} after ${ms} ms code=${closeEvent(h)?.c} delivered=${messages(h).length}`)
    h.handle?.close?.()
  }
  // protocol rows
  {
    for (const [name, c] of [['invalid UTF-8 text', 'badutf8'], ['server frame masked', 'masked'], ['RSV1 set without an extension', 'rsv1'], ['reserved opcode 3', 'badop'], ['fragmented ping', 'ctrlfrag'], ['continuation without a start', 'contfirst'], ['close with code 999', 'closebad']]) {
      fx.reset()
      const s = await open(openFn, `/feed?case=${c}`, good())
      const closed = await waitFor(() => closeEvent(s), 3000)
      t(`WS ${name}: nothing delivered, connection ends`, !s.error && closed && messages(s).length === 0, `close=${closeEvent(s)?.c} delivered=${messages(s).length}`)
      s.handle?.close?.()
    }
    fx.reset()
    const p = await open(openFn, '/feed?case=pingmid', good())
    await waitFor(() => messages(p).length >= 1)
    const gotPong = await waitFor(() => fx.upgrades[0]?.client.some((f) => f.op === 10 && f.payload.toString() === 'abc'), 1500)
    t('WS ping between fragments: message intact, pong echoes payload', messages(p)[0]?.d === 'hello' && gotPong, `message=${messages(p)[0]?.d} pong=${gotPong}`)
    p.handle?.close?.()
    fx.reset()
    const k = await open(openFn, '/feed?case=close', good())
    await waitFor(() => closeEvent(k), 2000)
    const echoed = await waitFor(() => fx.upgrades[0]?.client.some((f) => f.op === 8), 1500)
    t('WS server close 1000 "bye": close event 1000 and the client answers with a close frame', closeEvent(k)?.c === 1000 && echoed, `code=${closeEvent(k)?.c} reason=${closeEvent(k)?.r} echoed=${echoed}`)
    fx.reset()
    const ping = await open(openFn, '/feed?case=hello', good())
    if (ping.handle?.ping) {
      ping.handle.ping(Buffer.from('xyz'))
      const got = await waitFor(() => ping.events.some((e) => e.t === 'pong' && e.p.toString() === 'xyz'), 1500)
      t('WS client ping gets a pong (keepalive possible)', got, '')
    } else t('WS client ping gets a pong (keepalive possible)', false, 'no ping API')
    ping.handle?.close?.()
  }
  // latency to first message
  if (process.env.PB11_ONLY !== 'extra') {
    const lat = []
    for (let i = 0; i < 40; i++) {
      fx.reset()
      const t0 = performance.now()
      const s = await open(openFn, '/feed?case=hello', good())
      await waitFor(() => messages(s).length >= 1)
      if (i >= 10) lat.push(performance.now() - t0)
      s.handle?.close?.()
    }
    row(cand, 'latency', 'connect to first message, 30 runs after 10 warm-up', null, '', { metric: 'ms', p50: round(pct(lat, 50)), p95: round(pct(lat, 95)), max: round(Math.max(...lat)) })
  }
}

// ---------------------------------------------------------------- run
// PB11_ONLY=extra runs only the mutant WSS modules named in PB11_EXTRA_WSS (see test/mutants.mjs)
const onlyExtra = process.env.PB11_ONLY === 'extra'
if (!onlyExtra) {
  for (const [name, f] of Object.entries(HTTPS)) await httpsTables(name, f, { control: name.startsWith('N_') })
  for (const [name, f] of Object.entries(WSS)) await wsTables(name, f)
}
for (const file of (process.env.PB11_EXTRA_WSS ?? '').split(',').filter(Boolean)) {
  await wsTables(`X_${basename(file, '.mjs')}`, (await import(pathToFileURL(file).href)).openFeed)
}
if (onlyExtra) {
  const failed = rows.filter((r) => r.pass === false).map((r) => `${r.cand}: ${r.name}`)
  console.log('MUTANT_FAILS ' + JSON.stringify(failed))
  await fx.close()
  process.exit(0)
}

// memory under a hostile 256 MiB fragmented message (child process per candidate)
const child = (args, extraEnv = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [join(here, 'test/child.mjs'), ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PB11_PORT: String(fx.port), PB11_CA: fx.caPath, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  p.stderr.on('data', (d) => (out += d))
  p.on('close', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())) } catch { resolve({ raw: out.slice(-400) }) } })
})
const oversize = {}
for (const name of Object.keys(WSS)) {
  if (name === 'W1_global_plain') continue
  fx.reset()
  const r = await child(['oversize', name])
  oversize[name] = r
  await waitFor(() => fx.upgrades[0]?.closedAt, 3000)
  r.serverBytesWrittenMiB = Math.round(((fx.upgrades[0]?.bytesWritten ?? 0) / 2 ** 20) * 10) / 10
  const bounded = r.closeCode !== null && r.rssGrowthMiB < 32 && r.receivedBytes === 0
  row(name, 'P56', 'hostile 256 MiB fragmented message: memory stays bounded (RSS growth < 32 MiB), nothing delivered', bounded, JSON.stringify(r))
}

// system proxy behaviour (documented, not a gate)
const proxyLog = []
const proxy = net.createServer((client) => {
  client.once('data', (d) => {
    const line = d.toString().split('\r\n')[0]
    proxyLog.push(line)
    const upstream = net.connect(fx.port, '127.0.0.1', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); upstream.pipe(client); client.pipe(upstream) })
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
  })
})
await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
const proxyResult = await child(['proxy'], { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`, NO_PROXY: '' })
proxy.close()
const proxyNote = { childResult: proxyResult, proxySawConnects: proxyLog }
row('shared', 'proxy', 'NODE_USE_ENV_PROXY=1 with HTTPS_PROXY (document only)', null, JSON.stringify(proxyNote))

// root stores and a real-host smoke through the pinned stack
const roots = {
  node: process.versions.node, openssl: process.versions.openssl, undici: process.versions.undici, electron: process.versions.electron ?? null,
  bundledRoots: tls.rootCertificates.length,
}
try { roots.systemRoots = tls.getCACertificates('system').length } catch (e) { roots.systemRoots = `error ${e.message}` }
let smoke
{
  const t0 = performance.now()
  try {
    const res = await fetchText('https://example.com/', { host: 'example.com', resolve: systemResolve, timeoutMs: 8000 })
    smoke = { ok: true, status: res.status, type: res.type, bytes: res.text.length, ms: Math.round(performance.now() - t0) }
  } catch (e) {
    smoke = { ok: false, reason: e.reason ?? e.message, detail: e.message }
  }
}
let smokeSystem
try {
  const ca = [...tls.getCACertificates('bundled'), ...tls.getCACertificates('system')]
  const res = await fetchText('https://example.com/', { host: 'example.com', resolve: systemResolve, timeoutMs: 8000, ca })
  smokeSystem = { ok: true, status: res.status, caCount: ca.length }
} catch (e) { smokeSystem = { ok: false, reason: e.reason ?? e.message, detail: e.message } }
roots.defaultRoots = tls.getCACertificates('default').length
roots.setDefaultCACertificates = typeof tls.setDefaultCACertificates
row('A_https_request', 'tls', 'GET example.com with ca = bundled + system roots (how to honour a corporate root)', smokeSystem.ok ? true : null, JSON.stringify(smokeSystem))
row('A_https_request', 'tls', 'GET https://example.com through system DNS, real vetting, default roots', smoke.ok ? true : null, JSON.stringify({ ...smoke, roots }))

// ---------------------------------------------------------------- sizes and result file
const countLines = (file) => readFileSync(join(here, file), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length
const wsLibLines = readdirSync(join(here, 'node_modules/ws/lib')).filter((f) => f.endsWith('.js')).reduce((n, f) => n + readFileSync(join(here, 'node_modules/ws/lib', f), 'utf8').split('\n').length, 0)
const sizes = {
  'src/net-core.mjs (vetting, URL grant, pinning, shared by all)': countLines('src/net-core.mjs'),
  'src/https-fetch.mjs (HTTPS GET with caps and redirects)': countLines('src/https-fetch.mjs'),
  'src/ws-lite.mjs (WSS handshake and receive-only reader)': countLines('src/ws-lite.mjs'),
  'node_modules/ws/lib (candidate d, physical lines)': wsLibLines,
}
console.log(sizes)

await fx.close()
proxy.close()
const cases = rows.filter((r) => r.metric).map((r) => ({ name: `${r.cand}: ${r.name}`, metric: r.metric, p50: r.p50, p95: r.p95, max: r.max }))
const osName = os.platform() === 'darwin' ? `macos-${execFileSync('sw_vers', ['-productVersion']).toString().trim()}` : `${os.platform()}-${os.release()}`
const result = {
  probe: 'PB11', date: new Date().toISOString().slice(0, 10), os: osName, runner: process.env.PB11_RUNNER ?? 'local-node',
  cpu: os.cpus()[0]?.model, node: process.versions.node, electron: process.versions.electron ?? null, chromium: process.versions.chrome ?? null,
  cases, tables: rows.filter((r) => !r.metric), sizes, roots, oversize, proxy: proxyNote, smoke,
}
writeFileSync(outPath, JSON.stringify(result, null, 2))
console.log('wrote', outPath)
process.exit(0)
