import { HostEntry, RegisterPayload, HostListResponse } from './types.js';

const REGISTRY_TTL_MS = parseInt(process.env.REGISTRY_TTL || '75000', 10);
const registry = new Map<string, HostEntry>();

export function registrySize() { return registry.size; }

export function listHosts(opts?: { includeOffline?: boolean }): HostListResponse {
  const now = Date.now();
  const all = [...registry.values()];
  const online = all.filter(h => h.online && (now - h.lastSeen) < REGISTRY_TTL_MS);
  const hosts = opts?.includeOffline ? all : online;
  // sort by load then region
  hosts.sort((a,b) => (a.load - b.load) || a.region.localeCompare(b.region));

  // main host info (this process)
  const mainId = process.env.HOST_ID || `main-${process.env.PORT || '4433'}`;
  const mainHost = process.env.PUBLIC_HOST || 'localhost';
  const mainPort = parseInt(process.env.PORT || '4433', 10);
  const mainWss = process.env.PUBLIC_WSS || `wss://${mainHost}:${mainPort}${process.env.OPS_PATH || '/ops'}`;

  return {
    main: {
      id: mainId,
      host: mainHost,
      port: mainPort,
      wssUrl: mainWss,
      role: 'main',
      name: process.env.HOST_NAME || 'OpenPath Main',
      version: '1.0.0',
      country: process.env.HOST_COUNTRY || '',
      region: process.env.HOST_REGION || process.env.REGION || '',
      flag: process.env.HOST_FLAG || '',
    },
    hosts,
    total: all.length,
    online: online.length,
    updatedAt: now,
  };
}

export function registerHost(payload: RegisterPayload, reqIp: string): { entry: HostEntry; isNew: boolean } {
  const now = Date.now();
  const host = (payload.host || reqIp || 'unknown').replace(/^::ffff:/, '');
  const port = payload.port || 4434;
  const id = payload.id || `sub-${host}-${port}-${Math.random().toString(36).slice(2,6)}`;
  const existing = registry.get(id);

  const wssUrl = payload.wssUrl || `wss://${host}:${port}${process.env.OPS_PATH || '/ops'}`;

  // Support duckdnsUrl: if sub has its own duckdns domain, prefer it for public access
  const duckdnsUrl = payload.duckdnsUrl || (process.env.DUCKDNS_DOMAIN ? `https://${process.env.DUCKDNS_DOMAIN}.duckdns.org` : undefined);
  // If duckdnsUrl provided, derive wssUrl from it (wss://duckdns.org/ops on 443)
  const effectiveWss = payload.wssUrl || (duckdnsUrl ? `${duckdnsUrl.replace('https://','wss://').replace('http://','ws://')}${process.env.OPS_PATH || '/ops'}` : wssUrl);
  const effectivePublicUrl = payload.publicUrl || (duckdnsUrl ? `${duckdnsUrl}/health` : `http://${host}:${port}/health`);

  const entry: HostEntry = {
    id,
    name: payload.name || `Sub ${host}:${port}`,
    host,
    port,
    wssUrl: effectiveWss,
    wsUrl: effectiveWss,
    duckdnsUrl: payload.duckdnsUrl || duckdnsUrl,
    region: payload.region || process.env.HOST_REGION || 'home',
    country: payload.country || '',
    flag: payload.flag || '🏠',
    capacity: payload.capacity || 100,
    load: 0,
    sessions: 0,
    online: true,
    role: 'sub',
    version: payload.version || '1.0.0',
    createdAt: existing?.createdAt || now,
    lastSeen: now,
    publicUrl: effectivePublicUrl,
  };

  registry.set(id, entry);
  return { entry, isNew: !existing };
}

export function heartbeat(id: string): HostEntry | null {
  const h = registry.get(id);
  if (!h) return null;
  h.lastSeen = Date.now();
  h.online = true;
  return h;
}

export function unregister(id: string): boolean {
  return registry.delete(id);
}

export function updateLoad(id: string, sessions: number, latencyMs?: number) {
  const h = registry.get(id);
  if (!h) return;
  h.sessions = sessions;
  h.load = h.capacity ? sessions / h.capacity : 0;
  if (latencyMs !== undefined) h.latencyMs = latencyMs;
  h.lastSeen = Date.now();
}

export function pruneExpired(): number {
  const now = Date.now();
  let pruned = 0;
  for (const [id, h] of registry) {
    if (now - h.lastSeen > REGISTRY_TTL_MS) {
      // mark offline, then delete after 2× TTL
      if (h.online) {
        h.online = false;
        // keep for a bit so client sees offline, but mark
      } else if (now - h.lastSeen > REGISTRY_TTL_MS * 2) {
        registry.delete(id);
        pruned++;
      }
    }
  }
  return pruned;
}

// periodic prune + health check (main pings subs)
let pruneTimer: NodeJS.Timeout | null = null;
export function startRegistryPruner() {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    const n = pruneExpired();
    if (n) console.log(`[hosts] pruned ${n} expired sub-hosts, online=${[...registry.values()].filter(h=>h.online).length}`);
  }, 30000).unref?.();

  // health check subs every 45s (best effort)
  setInterval(async () => {
    for (const h of registry.values()) {
      if (!h.online) continue;
      const url = h.publicUrl || `http://${h.host}:${h.port}/health`;
      const start = Date.now();
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(url, { signal: ctrl.signal } as any);
        clearTimeout(t);
        if (res.ok) {
          h.latencyMs = Date.now() - start;
          h.lastSeen = Date.now(); // health counts as heartbeat
        } else {
          h.latencyMs = undefined;
        }
      } catch {
        // fetch fail is ok, keep lastSeen stale will prune
      }
    }
  }, 45000).unref?.();
}

export function getHost(id: string) { return registry.get(id); }
export function allHosts() { return [...registry.values()]; }
