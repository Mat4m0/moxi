// WSS candidates measured next to ws-lite: Node's global WebSocket (plain and with a dispatcher
// taken from the global one) and the npm package `ws` (measure only).
import https from 'node:https'
import WebSocketLib from 'ws'
import { NetError, parseGrantedUrl, pinnedLookup, resolveVetted } from './net-core.mjs'

async function prepare(rawUrl, cfg) {
  const url = parseGrantedUrl(rawUrl, 'wss:', cfg.host, cfg.port ?? '')
  const addresses = await resolveVetted(cfg.host, cfg.resolve, cfg.vet, AbortSignal.timeout(cfg.handshakeMs ?? 10_000))
  return { url, addresses }
}

/** Adapter for the WHATWG-shaped global WebSocket. */
function openGlobal(url, init, on) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, init)
    ws.binaryType = 'arraybuffer'
    let opened = false
    ws.addEventListener('open', () => { opened = true; resolve({ close: (code = 1000) => ws.close(code) }) })
    ws.addEventListener('message', (e) => on.message(e.data, typeof e.data !== 'string'))
    ws.addEventListener('close', (e) => {
      if (!opened) reject(new NetError('network', `closed ${e.code} before open`))
      else on.close(e.code, e.reason)
    })
    ws.addEventListener('error', () => { if (!opened) reject(new NetError('network', 'error event (no detail in the API)')) })
  })
}

/** (a) Node's global WebSocket as it is: no option names an address or a lookup. */
export async function openFeedGlobalPlain(rawUrl, cfg, on) {
  const { url } = await prepare(rawUrl, cfg)
  return openGlobal(url.href, { protocols: [] }, on)
}

/** The same, with an undici Agent built from the global dispatcher's constructor (private symbol). */
export async function openFeedGlobalDispatcher(rawUrl, cfg, on) {
  const { url, addresses } = await prepare(rawUrl, cfg)
  await fetch('data:,') // the first fetch call loads undici lazily and installs the default dispatcher
  const Agent = Object.getPrototypeOf(globalThis[Symbol.for('undici.globalDispatcher.1')]).constructor
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(cfg.host, addresses), ca: cfg.ca } })
  return openGlobal(url.href, { dispatcher }, on)
}

/** (d) `ws` with the same lookup. */
export async function openFeedWsLib(rawUrl, cfg, on) {
  const { url, addresses } = await prepare(rawUrl, cfg)
  const agent = new https.Agent({ keepAlive: false, maxCachedSessions: 0, ca: cfg.ca })
  const ws = new WebSocketLib(url.href, {
    agent, lookup: pinnedLookup(cfg.host, addresses), maxPayload: cfg.maxMessage ?? 64 * 1024,
    perMessageDeflate: false, followRedirects: false, handshakeTimeout: cfg.handshakeMs ?? 10_000,
    headers: { 'user-agent': cfg.userAgent ?? 'Moxi/0.0.0' },
  })
  return new Promise((resolve, reject) => {
    let opened = false
    ws.on('open', () => { opened = true; resolve({ ping: (p) => ws.ping(p), close: (code = 1000) => ws.close(code) }) })
    ws.on('message', (data, isBinary) => on.message(isBinary ? data : data.toString('utf8'), isBinary))
    ws.on('pong', (p) => on.pong?.(p))
    ws.on('close', (code, reason) => {
      agent.destroy()
      if (!opened) reject(new NetError('network', `closed ${code} before open`))
      else on.close(code, reason.toString())
    })
    ws.on('unexpected-response', (_req, res) => {
      res.destroy()
      reject(new NetError(res.statusCode >= 300 && res.statusCode < 400 ? 'redirect' : 'status'))
    })
    ws.on('error', (err) => {
      if (opened) return
      const tls = /CERT|SELF_SIGNED|UNABLE_TO|ERR_TLS|ERR_SSL/.test(err.code ?? '')
      reject(err instanceof NetError ? err : new NetError(tls ? 'tls' : 'network', err.code ?? err.message))
    })
  })
}
