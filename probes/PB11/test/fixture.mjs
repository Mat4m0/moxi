// Local TLS fixture: a throwaway CA (trusted only by the probe), HTTPS and WSS endpoints on
// 127.0.0.1, and a second listener on ::1 (or 127.0.0.2) that must never see a connection.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import https from 'node:https'
import tls from 'node:tls'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const OPENSSL_CNF = `[req]
distinguished_name = dn
prompt = no
[dn]
CN = pb11
[ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
[granted]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:granted.test
[other]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:other.test
`

function makePki() {
  const dir = mkdtempSync(join(tmpdir(), 'pb11-pki-'))
  const f = (name) => join(dir, name)
  const sh = (...args) => execFileSync('openssl', args, { stdio: 'pipe' })
  writeFileSync(f('o.cnf'), OPENSSL_CNF)
  sh('genrsa', '-out', f('ca.key'), '2048')
  sh('req', '-x509', '-new', '-key', f('ca.key'), '-sha256', '-days', '2', '-config', f('o.cnf'), '-extensions', 'ca', '-subj', '/CN=PB11 test CA', '-out', f('ca.pem'))
  sh('genrsa', '-out', f('leaf.key'), '2048')
  for (const name of ['granted', 'other']) {
    sh('req', '-new', '-key', f('leaf.key'), '-subj', `/CN=${name}.test`, '-out', f(`${name}.csr`))
    sh('x509', '-req', '-in', f(`${name}.csr`), '-CA', f('ca.pem'), '-CAkey', f('ca.key'), '-CAcreateserial', '-days', '2', '-sha256', '-extfile', f('o.cnf'), '-extensions', name, '-out', f(`${name}.pem`))
  }
  const key = readFileSync(f('leaf.key'))
  return {
    dir, caPath: f('ca.pem'), ca: readFileSync(f('ca.pem')),
    granted: tls.createSecureContext({ key, cert: readFileSync(f('granted.pem')) }),
    other: tls.createSecureContext({ key, cert: readFileSync(f('other.pem')) }),
    key, cert: readFileSync(f('granted.pem')),
  }
}

/** One RFC 6455 frame; `mask` and `rsv` exist so the server can send frames a client must refuse. */
export function frame(op, payload = Buffer.alloc(0), { fin = true, mask = false, rsv = 0, claim } = {}) {
  const len = claim ?? payload.length
  const head = [(fin ? 0x80 : 0) | rsv | op]
  const mbit = mask ? 0x80 : 0
  if (len < 126) head.push(mbit | len)
  else if (len < 65536) head.push(mbit | 126, len >> 8, len & 255)
  else { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); head.push(mbit | 127, ...b) }
  const key = Buffer.from([1, 2, 3, 4])
  const body = mask ? Buffer.from(payload.map((x, i) => x ^ key[i & 3])) : payload
  return Buffer.concat([Buffer.from(head), mask ? key : Buffer.alloc(0), body])
}

function readClientFrames(socket, sink) {
  const reply = (f) => {
    if (f.op === 9) socket.write(frame(10, f.payload))
    if (f.op === 8) socket.end()
  }
  let buf = Buffer.alloc(0)
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (buf.length < 6) return
      let len = buf[1] & 127, at = 2
      if (len === 126) { len = buf.readUInt16BE(2); at = 4 }
      if (buf.length < at + 4 + len) return
      const key = buf.subarray(at, at + 4)
      const payload = Buffer.from(buf.subarray(at + 4, at + 4 + len).map((x, i) => x ^ key[i & 3]))
      const f = { op: buf[0] & 15, payload }
      sink.push(f)
      reply(f)
      buf = buf.subarray(at + 4 + len)
    }
  })
}

export async function startFixture() {
  const pki = makePki()
  const state = {
    tcp: { A: 0, B: 0 }, snis: [], requests: [], upgrades: [], tickets: 0,
    reset() { this.tcp.A = this.tcp.B = 0; this.snis.length = 0; this.requests.length = 0; this.upgrades.length = 0 },
  }

  function makeServer(label) {
    const server = https.createServer({
      key: pki.key, cert: pki.cert,
      SNICallback: (name, cb) => { state.snis.push(name); cb(null, name === 'wrongcert.test' ? pki.other : pki.granted) },
    })
    server.on('connection', () => { state.tcp[label]++ })
    server.on('request', (req, res) => route(label, req, res))
    server.on('upgrade', (req, socket) => upgrade(label, req, socket))
    server.on('tlsClientError', () => {})
    return server
  }

  function route(label, req, res) {
    const url = new URL(req.url, 'https://x')
    const q = (k, d) => url.searchParams.get(k) ?? d
    state.requests.push({ label, path: req.url, headers: { ...req.headers }, reused: req.socket.isSessionReused() })
    const send = (status, type, body, extra = {}) => { res.writeHead(status, { 'content-type': type, ...extra }); res.end(body) }
    switch (url.pathname) {
      case '/ok': return send(200, 'application/json', '{"ok":true}', { 'set-cookie': `sid=${++state.tickets}`, etag: `"${state.tickets}"`, 'cache-control': 'max-age=60' })
      case '/hdrs': return send(200, 'application/json', JSON.stringify(req.headers))
      case '/size': {
        const n = Number(q('n', '0'))
        if (q('mode', 'cl') === 'cl') return send(200, 'text/plain', Buffer.alloc(n, 120))
        res.writeHead(200, { 'content-type': 'text/plain' })
        const chunk = Buffer.alloc(64 * 1024, 120)
        let left = n
        const pump = () => {
          while (left > 0) {
            const part = left >= chunk.length ? chunk : chunk.subarray(0, left)
            left -= part.length
            if (!res.write(part)) return res.once('drain', pump)
          }
          res.end()
        }
        return pump()
      }
      case '/slow': return setTimeout(() => send(200, 'text/plain', 'late'), Number(q('ms', '0')))
      case '/trickle': {
        res.writeHead(200, { 'content-type': 'text/plain' })
        const until = Date.now() + Number(q('ms', '0'))
        const t = setInterval(() => { if (Date.now() > until || res.destroyed) { clearInterval(t); res.end() } else res.write('x') }, 30)
        return res.on('close', () => clearInterval(t))
      }
      case '/redir': return send(302, 'text/plain', '', { location: q('to', '/ok') })
      case '/loop': {
        const n = Number(q('n', '0'))
        return n > 0 ? send(302, 'text/plain', '', { location: `/loop?n=${n - 1}` }) : send(200, 'application/json', '{"loop":"end"}')
      }
      case '/type': return send(200, 'application/octet-stream', Buffer.from([1, 2, 3]))
      case '/gz': return send(200, 'application/json', gzipSync('{"gz":true}'), { 'content-encoding': 'gzip' })
      case '/boom': return send(500, 'text/plain', 'no')
      default: return send(404, 'text/plain', 'nope')
    }
  }

  function upgrade(label, req, socket) {
    const url = new URL(req.url, 'https://x')
    const rec = { label, path: req.url, headers: { ...req.headers }, servername: socket.servername, remote: socket.remoteAddress, client: [], closedAt: 0, openedAt: Date.now() }
    state.upgrades.push(rec)
    socket.on('close', () => { rec.closedAt = Date.now(); rec.bytesWritten = socket.bytesWritten })
    socket.on('error', () => {})
    if (url.pathname === '/ws302') {
      socket.end('HTTP/1.1 302 Found\r\nLocation: https://other.test/feed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
      return
    }
    const accept = url.searchParams.get('case') === 'badaccept' ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' : createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64')
    const extension = url.searchParams.get('case') === 'ext' ? 'Sec-WebSocket-Extensions: permessage-deflate\r\n' : ''
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${extension}Sec-WebSocket-Accept: ${accept}\r\n\r\n`)
    readClientFrames(socket, rec.client)
    script(url, socket)
  }

  function script(url, socket) {
    const q = (k, d) => url.searchParams.get(k) ?? d
    const w = (...frames) => { for (const f of frames) socket.write(f) }
    const text = (s, o) => frame(1, Buffer.from(s), o)
    switch (q('case', 'hello')) {
      case 'hello': return w(text('hello'))
      case 'msgs': return w(text('one'), frame(2, Buffer.from([1, 2, 3])), text('three'))
      case 'size': return w(text('a'.repeat(Number(q('n', '1')))))
      case 'frag': {
        const total = Number(q('n', '70000')), parts = Number(q('parts', '7'))
        const each = Math.ceil(total / parts)
        for (let i = 0; i < parts; i++) w(frame(i === 0 ? 1 : 0, Buffer.alloc(Math.min(each, total - i * each), 97), { fin: i === parts - 1 }))
        return
      }
      case 'pingmid': return w(text('hel', { fin: false }), frame(9, Buffer.from('abc')), frame(0, Buffer.from('lo')))
      case 'badutf8': return w(frame(1, Buffer.from([0xc3, 0x28])))
      case 'masked': return w(text('x', { mask: true }))
      case 'rsv1': return w(text('x', { rsv: 0x40 }))
      case 'badop': return w(frame(3, Buffer.from('x')))
      case 'ctrlfrag': return w(frame(9, Buffer.from('p'), { fin: false }))
      case 'contfirst': return w(frame(0, Buffer.from('x')))
      case 'close': return w(frame(8, Buffer.concat([Buffer.from([0x03, 0xe8]), Buffer.from('bye')])))
      case 'closebad': return w(frame(8, Buffer.from([0x03, 0xe7])))
      case 'claimhuge': return w(frame(1, Buffer.alloc(1024 * 1024), { claim: 2 ** 30 }))
      case 'bigfrags': { // 256 MiB as one fragmented message, written with backpressure
        const piece = Buffer.alloc(4 * 1024 * 1024, 97)
        let i = 0
        const pump = () => {
          while (i < 64 && !socket.destroyed) {
            const last = i === 63
            const ok = socket.write(frame(i === 0 ? 1 : 0, piece, { fin: last }))
            i++
            if (!ok) return socket.once('drain', pump)
          }
        }
        return pump()
      }
      default: return undefined
    }
  }

  const A = makeServer('A')
  await new Promise((r) => A.listen(0, '127.0.0.1', r))
  const port = A.address().port
  let B = null, otherIp = null
  for (const ip of ['::1', '127.0.0.2']) { // a second place the stack must never connect to
    const server = makeServer('B')
    try {
      await new Promise((ok, bad) => { server.once('error', bad); server.listen(port, ip, ok) })
      B = server; otherIp = ip
      break
    } catch { server.close() }
  }
  return {
    ...state, state, pki, port, otherIp, caPath: pki.caPath, ca: pki.ca,
    async close() { A.closeAllConnections(); A.close(); B?.closeAllConnections(); B?.close() },
  }
}

/** A resolver with a script of answers per call; `calls` counts how often the stack asked. */
export function scriptedResolver(...answers) {
  const calls = []
  const resolve = async (host) => { calls.push(host); return answers[Math.min(calls.length, answers.length) - 1] }
  resolve.calls = calls
  return resolve
}

/** The production vetter, except that 127.0.0.1 plays "public" so the stack can reach the fixture. */
export const fixtureVet = (vetAddress) => (ip) => (ip === '127.0.0.1' ? null : vetAddress(ip))

export async function waitFor(cond, ms = 5000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return cond()
}
