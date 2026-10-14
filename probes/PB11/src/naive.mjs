// Negative control: the classic check-then-use gap. It vets one answer, then connects by name and
// lets the connection resolve again. The rebinding row must FAIL for this and PASS for the real stack.
import https from 'node:https'
import { isIP } from 'node:net'
import { NetError, parseGrantedUrl, resolveVetted } from './net-core.mjs'

export async function fetchTextNaive(rawUrl, cfg) {
  const url = parseGrantedUrl(rawUrl, 'https:', cfg.host, cfg.port ?? '')
  await resolveVetted(cfg.host, cfg.resolve, cfg.vet)
  const lookup = (host, options, cb) => {
    cfg.resolve(host).then((list) => {
      const entries = list.map((address) => ({ address, family: isIP(address) }))
      if (options.all) cb(null, entries)
      else cb(null, entries[0].address, entries[0].family)
    })
  }
  return new Promise((resolve, reject) => {
    const req = https.get({ host: url.hostname, port: url.port || 443, path: url.pathname, lookup, ca: cfg.ca, agent: false }, (res) => {
      let text = ''
      res.setEncoding('utf8').on('data', (d) => (text += d)).on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', (err) => reject(new NetError('network', err.code ?? err.message)))
  })
}
