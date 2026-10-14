// Mutation check for the WSS tables: each mutant breaks one rule in ws-lite.mjs; the tables must notice.
// usage: node test/mutants.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src/ws-lite.mjs'), 'utf8')
const mutants = {
  'accepts masked server frames': ['(buf[1] & 0x80) ||', ''],
  'accepts RSV bits': ['(buf[0] & 0x70) ||', ''],
  'accepts reserved opcodes': ['![0, 1, 2, 8, 9, 10].includes(op)', 'false'],
  'no message size cap': ['size + len > maxMessage', 'false'],
  'no UTF-8 check': ['if (kind === 1) message = utf8.decode(data)', 'if (kind === 1) message = data.toString()'],
  'control frames may fragment or be long': ['|| (op >= 8 && (!fin || len > 125))', ''],
  'continuation rules off': ['(op === 0) === (kind === 0)', 'false'],
  'no pong': ['if (op === 9) send(10, payload)', 'if (op === 9) void payload'],
  'accept key not checked': ["res.headers['sec-websocket-accept'] !== accept ||", 'false ||'],
  'close codes unchecked': ['len === 1 || (len >= 2 && !OK_CLOSE_CODES.has(code) && !(code >= 3000 && code <= 4999))', 'false'],
  'no pinned lookup': ['lookup: pinnedLookup(host, addresses),', ''],
  'no vetting': ['cfg.resolve, cfg.vet, AbortSignal', 'cfg.resolve, () => null, AbortSignal'],
  'redirect not told apart from other statuses': ["res.statusCode >= 300 && res.statusCode < 400 ? 'redirect' : 'status'", "'status'"],
  'unsolicited extension accepted': [" || res.headers['sec-websocket-extensions']", ''],
  'frame header waits for the whole payload before the size cap': ['if (op < 8 && size + len > maxMessage) return fail(1009)\n      if (buf.length < at + len) return', 'if (buf.length < at + len) return\n      if (op < 8 && size + len > maxMessage) return fail(1009)'],
}
const dir = join(root, '.mutants')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir)
const out = {}
for (const [name, [from, to]] of Object.entries(mutants)) {
  if (process.argv[2] && !name.includes(process.argv[2])) continue
  if (!source.includes(from)) { out[name] = ['PATTERN NOT FOUND']; continue }
  const file = join(dir, `${Object.keys(mutants).indexOf(name)}.mjs`)
  writeFileSync(file, source.replace(from, to).replaceAll("from './net-core.mjs'", "from '../src/net-core.mjs'"))
  let log = ''
  try {
    log = execFileSync(process.execPath, [join(root, 'run.mjs'), join(dir, 'x.json')], { env: { ...process.env, PB11_ONLY: 'extra', PB11_EXTRA_WSS: file }, timeout: 120_000 }).toString()
  } catch (e) { log = `${e.stdout ?? ''}\nCRASH ${e.message}` }
  const line = log.split('\n').find((l) => l.startsWith('MUTANT_FAILS '))
  out[name] = line ? JSON.parse(line.slice(13)).map((x) => x.replace(/^X_\d+: /, '')) : ['harness crashed']
  if (out[name].length === 0) { // the tables missed it: does the differential fuzz against ws notice?
    try {
      execFileSync(process.execPath, [join(root, 'test/fuzz.mjs'), '4000', '1'], { env: { ...process.env, PB11_LITE: file }, stdio: 'pipe', timeout: 120_000 })
    } catch (e) {
      const m = /"disagreements":(\d+)/.exec(String(e.stdout)) ?? []
      if (m[1]) out[name] = [`differential fuzz: ${m[1]} disagreements with ws in 4000 streams`]
    }
  }
}
rmSync(dir, { recursive: true, force: true })
let caught = 0
for (const [name, fails] of Object.entries(out)) {
  const killed = fails.length > 0 && !['harness crashed', 'PATTERN NOT FOUND'].includes(fails[0])
  if (killed) caught++
  console.log(`${killed ? 'KILLED  ' : fails[0] === 'PATTERN NOT FOUND' || fails[0] === 'harness crashed' ? 'INVALID ' : 'SURVIVED'} ${name}${killed ? `  <- ${fails.length} rows, e.g. ${fails[0]}` : ''}`)
}
console.log(`${caught}/${Object.keys(out).length} mutants killed`)
