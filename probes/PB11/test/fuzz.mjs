// Differential fuzz: the same random (valid and corrupted) server byte streams go to ws-lite's
// reader and to the reader inside `ws` 8.22.0. Delivered messages and the end state must agree.
// usage: node test/fuzz.mjs [runs] [seed]
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { frame } from './fixture.mjs'

const { receiver } = await import(process.env.PB11_LITE ? pathToFileURL(process.env.PB11_LITE).href : '../src/ws-lite.mjs')
const Receiver = createRequire(import.meta.url)('../node_modules/ws/lib/receiver.js')
const RUNS = Number(process.argv[2] ?? 20000)
let seed = Number(process.argv[3] ?? 1) >>> 0
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32 }
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = (xs) => xs[int(0, xs.length - 1)]
const CAP = 65536

const PIECES = ['a', 'é', '€', '😀', 'z', ' ']
function textBytes(n) {
  let s = '', bytes = 0
  while (bytes < n) { const p = pick(PIECES); s += p; bytes += Buffer.byteLength(p) }
  return Buffer.from(s)
}
const SIZES = [0, 1, 2, 5, 125, 126, 127, 300, 65535, 65536, 65537]
const closeFrame = (code, reason = '') => frame(8, Buffer.concat([Buffer.from([code >> 8, code & 255]), Buffer.from(reason)]))

function randomStream() {
  const frames = []
  for (let m = int(1, 4); m > 0; m--) {
    const binary = rnd() < 0.4
    const n = rnd() < 0.5 ? pick(SIZES) : int(0, 400)
    const body = binary ? Buffer.from(Array.from({ length: n }, () => int(0, 255))) : textBytes(n)
    const parts = rnd() < 0.5 ? int(1, 4) : 1
    const cuts = Array.from({ length: parts - 1 }, () => int(0, body.length)).sort((a, b) => a - b)
    const ends = [...cuts, body.length]
    const pieces = ends.map((end, i) => body.subarray(i ? ends[i - 1] : 0, end)) // may split inside a UTF-8 character
    pieces.forEach((piece, i) => {
      frames.push(frame(i === 0 ? (binary ? 2 : 1) : 0, piece, { fin: i === pieces.length - 1 }))
      if (rnd() < 0.3) frames.push(frame(pick([9, 10]), Buffer.from(pick(['', 'p', 'x'.repeat(125)]))))
    })
  }
  if (rnd() < 0.3) frames.push(closeFrame(pick([1000, 1001, 3000, 4999, 1011]), pick(['', 'bye'])))
  return frames
}

function corrupt(frames) {
  const out = frames.map((f) => Buffer.from(f))
  const i = int(0, out.length - 1)
  const f = out[i]
  switch (int(0, 8)) {
    case 0: f[0] ^= 0x80 >> int(0, 3); break // fin or rsv bits
    case 1: f[0] = (f[0] & 0xf0) | int(0, 15); break // opcode
    case 2: f[1] ^= 0x80; break // mask bit
    case 3: f[1] = (f[1] & 0x80) | int(0, 127); break // length field
    case 4: return [Buffer.concat(out.slice(0, i)), f.subarray(0, int(0, f.length))].filter((b) => b.length) // truncated
    case 5: f[int(0, f.length - 1)] ^= 1 << int(0, 7); break // any bit
    case 6: { // 64-bit length that is too large
      const b = Buffer.alloc(10)
      b[0] = f[0]; b[1] = 127
      b.writeBigUInt64BE(BigInt(pick([65537, 2 ** 32, 2 ** 40, 2 ** 63])), 2)
      out[i] = b
      break
    }
    case 7: out.splice(i, 0, frame(8, Buffer.from(pick([[], [3], [3, 0xe7], [4, 0xb8], [3, 0xe8, 0xff], [3, 0xe8, 0xc3, 0x28]])))); break
    default: out.splice(i, 1)
  }
  return out
}

function chunks(buf) {
  if (rnd() < 0.3) return [buf]
  const out = []
  for (let at = 0; at < buf.length;) { const n = int(1, rnd() < 0.5 ? 7 : 70); out.push(buf.subarray(at, at + n)); at += n }
  return out
}

const hex = (d, binary) => `${binary ? 'b' : 't'}:${Buffer.from(d).toString('hex')}`

function runLite(parts) {
  const socket = Object.assign(new EventEmitter(), { write() {}, end() {}, destroy() {} })
  const result = { messages: [], end: 'open' }
  receiver(socket, Buffer.alloc(0), CAP, {
    message: (d, binary) => result.messages.push(hex(d, binary)),
    close: (_code, _reason, failed) => { result.end = failed ? 'error' : 'closed' },
  }, { destroy() {} })
  for (const p of parts) socket.emit('data', p)
  return result
}

async function runWs(parts) {
  const result = { messages: [], end: 'open' }
  const r = new Receiver({ allowSynchronousEvents: true, binaryType: 'nodebuffer', extensions: {}, isServer: false, maxPayload: CAP, skipUTF8Validation: false })
  r.on('message', (d, binary) => result.messages.push(hex(d, binary)))
  r.on('conclude', () => { if (result.end === 'open') result.end = 'closed' })
  r.on('error', () => {})
  for (const p of parts) {
    const err = await new Promise((done) => r.write(p, done)) // ws reports a protocol error through the write callback
    if (err) { result.end = 'error'; break }
    if (result.end === 'closed') break
  }
  r.destroy()
  return result
}

let disagreements = 0, shown = 0
const stats = { valid: 0, corrupted: 0, error: 0, closed: 0, open: 0, delivered: 0 }
for (let run = 0; run < RUNS; run++) {
  let frames = randomStream()
  const bad = rnd() < 0.6
  if (bad) frames = corrupt(frames)
  const bytes = Buffer.concat(frames)
  const parts = chunks(bytes)
  if (process.env.DUMP === String(run)) console.log('STREAM', bytes.toString('hex'), parts.map((c) => c.length).join(','))
  const a = runLite(parts), b = await runWs(parts)
  stats[bad ? 'corrupted' : 'valid']++
  stats[b.end]++
  stats.delivered += b.messages.length
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    disagreements++
    if (shown++ < 5) console.log('DISAGREE', { run, length: bytes.length, tailHex: bytes.subarray(-48).toString('hex'), lite: { ...a, messages: a.messages.map((m) => m.slice(0, 24)) }, ws: { ...b, messages: b.messages.map((m) => m.slice(0, 24)) } })
  }
}
console.log(JSON.stringify({ runs: RUNS, seed: process.argv[3] ?? 1, disagreements, ...stats }))
process.exit(disagreements ? 1 : 0)
