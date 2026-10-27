/**
 * Sub-host client: when ROLE=sub, this module registers this server with the main host
 * and sends periodic heartbeats. Main host URL is MAIN_URL env (e.g. http://main:4433)
 *
 * No secrets needed — sub uses same demo PSK; main verifies sub via simple IP allow or shared PSK if set.
 */

export interface SubOptions {
  mainUrl: string;      // e.g. http://192.168.1.10:4433
  id: string;
  name: string;
  host: string;
  port: number;
  wssUrl: string;
  duckdnsUrl?: string;
  region: string;
  country: string;
  flag: string;
}

function getSubConfig(): SubOptions | null {
  const role = (process.env.ROLE || process.env.OP_ROLE || 'main').toLowerCase();
  if (role !== 'sub' && role !== 'worker' && role !== 'node') return null;

  const mainUrl = process.env.MAIN_URL || process.env.MAIN_HOST || '';
  if (!mainUrl) {
    console.log('[sub] ROLE=sub but MAIN_URL not set — cannot register with main. Example: MAIN_URL=http://192.168.1.10:4433');
    return null;
  }

  const port = parseInt(process.env.PORT || '4434', 10);
  const hostEnv = process.env.PUBLIC_HOST || process.env.HOST_PUBLIC || '';
  // try to guess host: PUBLIC_HOST > hostname > localhost
  let host = hostEnv || 'localhost';
  if (!hostEnv) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const os = require('os');
      const ifaces = os.networkInterfaces();
      for (const arr of Object.values(ifaces) as any[]) {
        for (const i of arr) if (i.family === 'IPv4' && !i.internal) { host = i.address; break; }
      }
    } catch {}
  }

  const wssUrl = process.env.PUBLIC_WSS || process.env.WSS_URL || `wss://${host}:${port}${process.env.OPS_PATH || '/ops'}`;
  // DuckDNS for sub host: if DUCKDNS_DOMAIN set for this sub, prefer duckdns wss URL
  const duckdnsDomain = process.env.DUCKDNS_DOMAIN || process.env.SUB_DUCKDNS_DOMAIN || '';
  const duckdnsUrl = duckdnsDomain ? `https://${duckdnsDomain}.duckdns.org` : undefined;
  const effectiveWss = duckdnsUrl ? `wss://${duckdnsDomain}.duckdns.org${process.env.OPS_PATH || '/ops'}` : wssUrl;

  return {
    mainUrl: mainUrl.replace(/\/+$/, ''),
    id: process.env.HOST_ID || `sub-${host}-${port}`,
    name: process.env.HOST_NAME || `Sub ${host}:${port}`,
    host,
    port,
    wssUrl: effectiveWss,
    duckdnsUrl,
    region: process.env.HOST_REGION || process.env.REGION || 'home',
    country: process.env.HOST_COUNTRY || 'CA',
    flag: process.env.HOST_FLAG || '🔗',
  };
}

export async function startSubRegistration() {
  const cfg = getSubConfig();
  if (!cfg) return; // not a sub

  console.log(`[sub] Sub-host mode: will register with main ${cfg.mainUrl} as ${cfg.id} (${cfg.host}:${cfg.port})`);
  console.log(`[sub]   wssUrl=${cfg.wssUrl} region=${cfg.region}${cfg.duckdnsUrl ? ` duckdns=${cfg.duckdnsUrl}` : ''}`);

  const register = async () => {
    try {
      const res = await fetch(`${cfg.mainUrl}/api/hosts/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cfg.id,
          name: cfg.name,
          host: cfg.host,
          port: cfg.port,
          wssUrl: cfg.wssUrl,
          duckdnsUrl: cfg.duckdnsUrl,
          region: cfg.region,
          country: cfg.country,
          flag: cfg.flag,
          version: '1.0.0',
        }),
      } as any);
      const j: any = await res.json();
      if (j.ok) {
        console.log(`[sub] Registered with main OK (isNew=${j.isNew}) — ${cfg.id}`);
        return true;
      } else {
        console.log(`[sub] Register failed:`, j);
        return false;
      }
    } catch (e: any) {
      console.log(`[sub] Register error (main may be offline): ${e?.message || e}`);
      return false;
    }
  };

  const heartbeat = async () => {
    try {
      const res = await fetch(`${cfg.mainUrl}/api/hosts/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cfg.id }),
      } as any);
      const j: any = await res.json();
      if (!j.ok) {
        // if heartbeat says unknown, re-register
        console.log(`[sub] Heartbeat said unknown, re-registering...`);
        await register();
      }
    } catch (e: any) {
      // main offline, will retry
    }
  };

  // initial register with retries
  let registered = false;
  for (let i = 0; i < 5; i++) {
    registered = await register();
    if (registered) break;
    const wait = 3000 + i * 2000;
    console.log(`[sub] retry in ${wait}ms ...`);
    await new Promise(r => setTimeout(r, wait));
  }

  if (!registered) {
    console.log(`[sub] Could not register with main after retries — will keep retrying in background`);
  }

  // heartbeat every 25s
  const interval = parseInt(process.env.HEARTBEAT_INTERVAL || '25000', 10);
  setInterval(heartbeat, interval).unref?.();

  // graceful unregister on exit
  const doUnregister = async () => {
    try {
      await fetch(`${cfg.mainUrl}/api/hosts/unregister`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cfg.id }),
      } as any);
      console.log(`[sub] Unregistered from main on shutdown`);
    } catch {}
  };
  process.on('SIGINT', async () => { await doUnregister(); process.exit(0); });
  process.on('SIGTERM', async () => { await doUnregister(); process.exit(0); });
}
