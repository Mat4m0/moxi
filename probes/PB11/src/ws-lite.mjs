// Candidate (c) for WSS: the handshake through node:https.request (pinned lookup, Node parses the
// HTTP), then a receive-only RFC 6455 reader. Feeds never send data, so only control frames go out.
import https from 'node:https'
import { createHash, randomBytes } from 'node:crypto'
import { NetError, mapSocketError, parseGrantedUrl, pinnedLookup, resolveVetted } from './net-core.mjs'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const OK_CLOSE_CODES = new Set([1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014])
const utf8 = new TextDecoder('utf-8', { fatal: true })

/** on: { message(data, isBinary), close(code, reason), pong?(payload) }. Resolves once the socket is open. */
export async function openFeed(rawUrl, cfg, on) {
  const { host, port = '', maxMessage = 64 * 1024, handshakeMs = 10_000 } = cfg
  const url = parseGrantedUrl(rawUrl, 'wss:', host, port)
  const addresses = await resolveVetted(host, cfg.resolve, cfg.vet, AbortSignal.timeout(handshakeMs))
  const key = randomBytes(16).toString('base64')
  const agent = new https.Agent({ keepAlive: false, maxCachedSessions: 0, ca: cfg.ca })
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: url.hostname, port: url.port || 443, path: url.pathname + url.search, agent,
      lookup: pinnedLookup(host, addresses),
      headers: {
        connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': key,
        'user-agent': cfg.userAgent ?? 'Moxi/0.0.0',
      },
    })
    const timer = setTimeout(() => req.destroy(new NetError('timeout')), handshakeMs)
    const refuse = (err) => { clearTimeout(timer); agent.destroy(); reject(mapSocketError(err)) }
    req.on('error', refuse)
    req.on('response', (res) => { res.destroy(); refuse(new NetError(res.statusCode >= 300 && res.statusCode < 400 ? 'redirect' : 'status')) })
    req.on('upgrade', (res, socket, head) => {
      clearTimeout(timer)
      const accept = createHash('sha1').update(key + GUID).digest('base64')
      if (res.headers['sec-websocket-accept'] !== accept || res.headers['sec-websocket-extensions'] || res.headers['sec-websocket-protocol']) {
        socket.destroy()
        return refuse(new NetError('network', 'bad handshake'))
      }
      resolve(receiver(socket, head, maxMessage, on, agent))
    })
    req.end()
  })
}

export function receiver(socket, head, maxMessage, on, agent) {
  let buf = head, parts = [], size = 0, kind = 0, done = false
  const send = (op, payload = Buffer.alloc(0)) => {
    const mask = randomBytes(4)
    const masked = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]))
    socket.write(Buffer.concat([Buffer.from([0x80 | op, 0x80 | payload.length]), mask, masked]))
  }
  const finish = (code, reason = '', failed = false) => {
    if (done) return
    done = true
    socket.end() // flushes our close frame first
    setTimeout(() => { socket.destroy(); agent.destroy() }, 1000).unref()
    on.close(code, reason, failed)
  }
  const fail = (code) => {
    if (!done) send(8, Buffer.from([code >> 8, code & 255]))
    finish(code, '', true)
  }
  const deliver = (data) => {
    let message = data
    try {
      if (kind === 1) message = utf8.decode(data)
    } catch {
      return fail(1007)
    }
    const binary = kind === 2
    parts = []; size = 0; kind = 0
    on.message(message, binary)
  }
  const parse = () => {
    while (!done && buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f
      let len = buf[1] & 0x7f, at = 2
      if ((buf[0] & 0x70) || (buf[1] & 0x80) || ![0, 1, 2, 8, 9, 10].includes(op) || (op >= 8 && (!fin || len > 125))) return fail(1002)
      if (len === 126 && buf.length >= 4) { len = buf.readUInt16BE(2); at = 4 }
      else if (len === 127 && buf.length >= 10) { len = buf.readUInt32BE(2) ? Infinity : buf.readUInt32BE(6); at = 10 }
      else if (len >= 126) return
      if (op < 8 && ((op === 0) === (kind === 0))) return fail(1002) // continuation needs a start; a start needs none open
      if (op < 8 && size + len > maxMessage) return fail(1009)
      if (buf.length < at + len) return
      const payload = buf.subarray(at, at + len)
      buf = buf.subarray(at + len)
      if (op === 9) send(10, payload)
      else if (op === 10) on.pong?.(payload)
      else if (op === 8) {
        const code = len >= 2 ? payload.readUInt16BE(0) : 1005
        if (len === 1 || (len >= 2 && !OK_CLOSE_CODES.has(code) && !(code >= 3000 && code <= 4999))) return fail(1002)
        try { utf8.decode(payload.subarray(2)) } catch { return fail(1007) }
        send(8, payload.subarray(0, 2))
        return finish(code, payload.subarray(2).toString())
      } else {
        kind ||= op
        parts.push(payload); size += len
        if (fin) deliver(Buffer.concat(parts))
      }
    }
  }
  socket.on('data', (chunk) => {
    if (done) return
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    parse()
  })
  socket.on('close', () => finish(1006))
  socket.on('error', () => {})
  queueMicrotask(parse)
  return { ping: (p) => send(9, p), close: (code = 1000) => { send(8, Buffer.from([code >> 8, code & 255])); finish(code) } }
}
