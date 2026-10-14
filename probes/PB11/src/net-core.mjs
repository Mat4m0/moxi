// Shared rules for the Main network stack probe (PB11): typed refusals, address vetting,
// the granted-URL check (P54), resolve-once-then-pin (P55).
import { BlockList, isIP } from 'node:net'
import { lookup as systemLookup } from 'node:dns/promises'

export class NetError extends Error {
  constructor(reason, detail = '') {
    super(detail ? `${reason}: ${detail}` : reason)
    this.reason = reason
  }
}

const nonPublic4 = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) nonPublic4.addSubnet(net, bits, 'ipv4')

// IPv6: allow only global unicast 2000::/3, minus ranges that embed or tunnel IPv4 or are reserved.
// This refuses ::1, ::, fc00::/7, fe80::/10, ff00::/8, ::ffff:0:0/96 and 64:ff9b::/96 without listing them.
const global6 = new BlockList()
global6.addSubnet('2000::', 3, 'ipv6')
const reserved6 = new BlockList()
for (const [net, bits] of [['2001::', 32], ['2001:2::', 48], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  reserved6.addSubnet(net, bits, 'ipv6')
}

/** null when `ip` is a public unicast address; otherwise why it is refused. */
export function vetAddress(ip) {
  const family = isIP(ip)
  if (family === 0 || ip.includes('%')) return 'not an IP address'
  if (family === 4) return nonPublic4.check(ip, 'ipv4') ? 'non-public IPv4' : null
  return global6.check(ip, 'ipv6') && !reserved6.check(ip, 'ipv6') ? null : 'non-public IPv6'
}

/** getaddrinfo (honours hosts file and VPN DNS); the injected resolver replaces this in tests. */
export const systemResolve = async (host) =>
  (await systemLookup(host, { all: true, verbatim: true })).map((a) => a.address)

/** P54: only `<scheme>//<granted host>/…` on the default port passes; every other input has a typed refusal. */
export function parseGrantedUrl(input, scheme, grantedHost, port = '') {
  let url
  try {
    url = new URL(input)
  } catch {
    throw new NetError('url')
  }
  if (url.protocol !== scheme) throw new NetError('scheme', url.protocol)
  if (url.username || url.password) throw new NetError('userinfo')
  if (url.hostname.startsWith('[') || isIP(url.hostname)) throw new NetError('literal', url.hostname)
  if (url.port !== port) throw new NetError('port', url.port)
  if (url.hostname !== grantedHost) throw new NetError('host', url.hostname)
  return url
}

/**
 * Resolve once, vet every answer, return the vetted list. One private answer refuses the host:
 * a public host that also publishes a private record is not one to talk to.
 */
export async function resolveVetted(host, resolve, vet = vetAddress, signal = AbortSignal.timeout(10_000)) {
  let answers
  try {
    answers = await new Promise((ok, bad) => {
      if (signal.aborted) return bad(new NetError('timeout'))
      signal.addEventListener('abort', () => bad(new NetError('timeout')), { once: true }) // a stuck resolver must not outlive the deadline
      resolve(host).then(ok, bad)
    })
  } catch (err) {
    throw err instanceof NetError ? err : new NetError('dns', err?.code ?? String(err))
  }
  if (answers.length === 0) throw new NetError('dns', 'no answer')
  for (const ip of answers) {
    const why = vet(ip)
    if (why) throw new NetError('address', `${ip} ${why}`)
  }
  return answers
}

/** A `lookup` for node:net / node:tls that only ever returns the vetted addresses of `host`. */
export function pinnedLookup(host, addresses) {
  const entries = addresses.map((address) => ({ address, family: isIP(address) }))
  return (hostname, options, callback) => {
    const list = options.family ? entries.filter((e) => e.family === options.family) : entries
    process.nextTick(() => {
      if (hostname !== host || list.length === 0) return callback(new NetError('address', `lookup of ${hostname}`))
      if (options.all) return callback(null, list)
      callback(null, list[0].address, list[0].family)
    })
  }
}

export function mapSocketError(err) {
  if (err instanceof NetError) return err
  if (['AbortError', 'TimeoutError'].includes(err?.name) || err?.code === 'ABORT_ERR') return new NetError('timeout')
  if (/CERT|SELF_SIGNED|UNABLE_TO|ERR_TLS|ERR_SSL|HOSTNAME_MISMATCH/.test(err?.code ?? '')) {
    return new NetError('tls', err.code)
  }
  return new NetError('network', err?.code ?? String(err))
}
