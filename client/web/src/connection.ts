export type Mode = 'stealth' | 'fast'

export type HostEntry = {
  id: string
  name: string
  host: string
  port: number
  wssUrl: string
  region?: string
  country?: string
  flag?: string
  load?: number
  online: boolean
  latencyMs?: number
}

export type HostDirectory = {
  main: { id: string; name: string; wssUrl: string; country?: string; region?: string; flag?: string }
  hosts: HostEntry[]
  online: number
  total: number
}

export type ServerTarget = {
  id: string
  name: string
  url: string
  country: string
  region: string
  flag: string
  load?: number
  latencyMs?: number
  isMain: boolean
}

export function defaultServerUrl(loc: Pick<Location, 'protocol' | 'host'>): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ops`
}

export function parseServerUrl(value: string): URL {
  const url = new URL(value.trim())
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('Use a ws:// or wss:// server address')
  if (url.hash) throw new Error('Server addresses cannot contain a fragment')
  let hasSecret = false
  url.searchParams.forEach((_value, key) => { if (/^(psk|password|secret)$/i.test(key)) hasSecret = true })
  if (url.username || url.password || hasSecret) {
    throw new Error('Enter credentials in Settings, not in the server address')
  }
  return url
}

export function directoryUrl(serverUrl: string): string {
  const url = parseServerUrl(serverUrl)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/api/hosts'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function modeUrl(serverUrl: string, mode: Mode): URL {
  const url = parseServerUrl(serverUrl)
  if (mode === 'fast' && url.pathname === '/ops') url.pathname = '/fast'
  if (mode === 'stealth' && url.pathname === '/fast') url.pathname = '/ops'
  url.searchParams.delete('auth')
  url.searchParams.delete('user')
  url.searchParams.delete('mode')
  url.searchParams.delete('fast')
  if (mode === 'fast') url.searchParams.set('mode', 'fast')
  return url
}

export function countryFlag(code: string): string {
  const value = code.toUpperCase()
  return /^[A-Z]{2}$/.test(value) ? String.fromCodePoint(...[...value].map(c => 127397 + c.charCodeAt(0))) : '🌐'
}

export function countryName(code: string): string {
  if (!code || code === 'AUTO') return 'Any available server'
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) || code }
  catch { return code }
}

export function directoryTargets(directory: HostDirectory | null, mainUrl: string): ServerTarget[] {
  if (!directory) return []
  const main: ServerTarget = {
    id: directory.main?.id || 'main',
    name: directory.main?.name || 'Configured server',
    // The directory may advertise a private hostname. The address used to reach it is the usable one.
    url: mainUrl,
    country: (directory.main?.country || '').toUpperCase(),
    region: directory.main?.region || '',
    flag: directory.main?.flag || countryFlag(directory.main?.country || ''),
    isMain: true,
  }
  const subs = (directory.hosts || []).flatMap(host => {
    if (!host.online) return []
    try { parseServerUrl(host.wssUrl) } catch { return [] }
    return [{
      id: host.id,
      name: host.name,
      url: host.wssUrl,
      country: (host.country || '').toUpperCase(),
      region: host.region || '',
      flag: host.flag || countryFlag(host.country || ''),
      load: host.load,
      latencyMs: host.latencyMs,
      isMain: false,
    }]
  })
  return [main, ...subs]
}

export function selectProfileServer(
  targets: ServerTarget[], mainUrl: string, profile: { countryCode: string; city: string },
): ServerTarget {
  const code = (profile.countryCode || 'AUTO').toUpperCase()
  const hasRegion = !!profile.city && profile.city !== 'Fastest'
  if (code === 'AUTO' && !hasRegion) {
    return targets.find(target => target.isMain) || {
      id: 'main', name: 'Configured server', url: mainUrl, country: '', region: '', flag: '🌐', isMain: true,
    }
  }
  if (!targets.length) throw new Error('Refresh the server list before connecting to a specific location')
  const matches = targets.filter(target => (code === 'AUTO' || target.country === code) &&
    (!hasRegion || target.region.toLowerCase() === profile.city.toLowerCase()))
  if (!matches.length) {
    const where = code === 'AUTO' ? `region ${profile.city}` : `${countryName(code)}${hasRegion ? `, ${profile.city}` : ''}`
    throw new Error(`No online server available for ${where}`)
  }
  // Prefer measured latency when supplied, then reported load. Unmeasured hosts stay in directory order.
  return [...matches].sort((a, b) => {
    const latencyA = a.latencyMs ?? Infinity, latencyB = b.latencyMs ?? Infinity
    if (latencyA !== latencyB) return latencyA - latencyB
    const loadA = a.load ?? Infinity, loadB = b.load ?? Infinity
    return loadA === loadB ? 0 : loadA - loadB
  })[0]
}
