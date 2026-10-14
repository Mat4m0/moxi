// Candidate (a) for HTTPS: node:https.request with a pinned `lookup`.
import https from 'node:https'
import { NetError, mapSocketError, parseGrantedUrl, pinnedLookup, resolveVetted } from './net-core.mjs'

const TEXTUAL = /^(text\/[\w.+-]+|application\/(json|[\w.+-]+\+json))\s*(;|$)/i

/** GET `rawUrl` from the granted host. Never returns more than `maxBytes` of text or JSON. */
export async function fetchText(rawUrl, cfg) {
  const { host, port = '', timeoutMs = 10_000, maxBytes = 4 * 2 ** 20, maxRedirects = 3 } = cfg
  const signal = AbortSignal.timeout(timeoutMs)
  let url = parseGrantedUrl(rawUrl, 'https:', host, port)
  const addresses = await resolveVetted(host, cfg.resolve, cfg.vet, signal) // once; same-host redirects reuse it
  const agent = new https.Agent({ keepAlive: false, maxCachedSessions: 0, ca: cfg.ca })
  try {
    for (let hop = 0; ; hop++) {
      const res = await request(url, agent, pinnedLookup(host, addresses), cfg, signal)
      const location = res.headers.location
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        res.resume()
        if (hop === maxRedirects) throw new NetError('redirect', 'too many')
        try {
          url = parseGrantedUrl(new URL(location, url).href, 'https:', host, port)
        } catch (err) {
          throw new NetError('redirect', err.message)
        }
        continue
      }
      return await readBody(res, maxBytes, signal)
    }
  } finally {
    agent.destroy()
  }
}

function request(url, agent, lookup, cfg, signal) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: url.hostname, port: url.port || 443, path: url.pathname + url.search, method: 'GET',
        agent, lookup, signal, // servername (SNI) and certificate name check default to `host`
        headers: { accept: 'application/json, text/*', 'user-agent': cfg.userAgent ?? 'Moxi/0.0.0' },
      },
      resolve,
    )
    req.on('error', (err) => reject(mapSocketError(err)))
    req.end()
  })
}

function readBody(res, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    // Settle first, then destroy: destroy() itself raises an 'error' that must not win.
    const fail = (err) => { reject(err); res.destroy() }
    const broken = (err) => reject(mapSocketError(signal.aborted ? signal.reason : err))
    res.on('error', broken)
    res.on('aborted', () => broken(new Error('aborted')))
    const type = res.headers['content-type'] ?? ''
    const encoding = res.headers['content-encoding']
    if (res.statusCode < 200 || res.statusCode > 299) return fail(new NetError('status', String(res.statusCode)))
    if (!TEXTUAL.test(type) || (encoding && encoding !== 'identity')) return fail(new NetError('type', type))
    if (Number(res.headers['content-length']) > maxBytes) return fail(new NetError('size'))
    const chunks = []
    let size = 0
    res.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) return fail(new NetError('size'))
      chunks.push(chunk)
    })
    res.on('end', () => resolve({ status: res.statusCode, type, text: Buffer.concat(chunks).toString('utf8') }))
  })
}
