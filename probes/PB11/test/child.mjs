// Child process for measurements that must not share memory or environment with the fixture.
// usage: node child.mjs oversize <candidate> | proxy
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import https from 'node:https'
import { WSS } from '../src/candidates.mjs'
import { fetchText } from '../src/https-fetch.mjs'
import { pinnedLookup } from '../src/net-core.mjs'

const port = process.env.PB11_PORT
const ca = readFileSync(process.env.PB11_CA)
const host = 'granted.test'
const resolve = async () => ['127.0.0.1']
const vet = () => null
const [mode, name] = process.argv.slice(2)
const mib = (n) => Math.round((n / 2 ** 20) * 10) / 10

if (mode === 'oversize') {
  // A hostile feed sends one 256 MiB message in 4 MiB fragments. How much does the stack buffer?
  let peak = 0
  const t0 = performance.now()
  const base = process.memoryUsage().rss
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 10)
  const out = { candidate: name, receivedBytes: 0, closeCode: null, ms: 0 }
  await new Promise((done) => {
    const stop = setTimeout(done, 30_000)
    WSS[name](`wss://${host}:${port}/feed?case=bigfrags`, { host, port, resolve, vet, ca, maxMessage: 64 * 1024 }, {
      message: (d) => { out.receivedBytes = d.byteLength ?? d.length ?? d.size; clearTimeout(stop); done() },
      close: (code) => { out.closeCode = code; clearTimeout(stop); done() },
    }).catch((e) => { out.error = e.message; clearTimeout(stop); done() })
  })
  clearInterval(timer)
  out.ms = Math.round(performance.now() - t0)
  out.rssGrowthMiB = mib(Math.max(peak, process.memoryUsage().rss) - base)
  console.log(JSON.stringify(out))
  process.exit(0)
}

if (mode === 'proxy') {
  const out = { env: process.env.HTTPS_PROXY, useEnvProxy: process.env.NODE_USE_ENV_PROXY }
  const attempt = async (label, fn) => { try { out[label] = await fn() } catch (e) { out[label] = `error ${e.reason ?? e.code ?? e.message}` } }
  // The obvious code: pinned lookup on the default agent. A proxy gets the NAME and resolves it itself.
  await attempt('default_agent_with_lookup', () => new Promise((res, rej) => {
    https.get({ host, port, path: '/ok', lookup: pinnedLookup(host, ['127.0.0.1']), ca }, (r) => { r.resume(); res(r.statusCode) }).on('error', rej)
  }))
  await attempt('own_agent_fetchText', async () => (await fetchText(`https://${host}:${port}/ok`, { host, port, resolve, vet, ca })).status)
  await attempt('global_dispatcher_class', async () => {
    await fetch('data:,')
    return Object.getPrototypeOf(globalThis[Symbol.for('undici.globalDispatcher.1')]).constructor.name
  })
  await attempt('ws_global_dispatcher', () => new Promise((res, rej) => {
    WSS.W1b_global_dispatcher(`wss://${host}:${port}/feed?case=hello`, { host, port, resolve, vet, ca }, { message: (d) => res(`message ${d}`), close: () => {} }).catch(rej)
  }))
  console.log(JSON.stringify(out))
  process.exit(0)
}
