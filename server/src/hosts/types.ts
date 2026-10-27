export type HostRole = 'main' | 'sub';

export interface HostEntry {
  id: string;              // unique host id (hostname-port-random)
  name: string;            // friendly name e.g. "Montreal-1"
  host: string;            // public host/IP for clients (e.g. 192.168.1.10 or your.duckdns.org)
  port: number;            // public port (e.g. 4433, 4434)
  wssUrl: string;          // wss://host:port/ops
  wsUrl?: string;           // alias
  duckdnsUrl?: string;     // https://sub.duckdns.org if sub has its own duckdns domain
  region: string;          // e.g. us-east, eu, home
  country: string;         // e.g. US, CA
  flag: string;            // emoji flag
  capacity: number;        // max sessions (for load)
  load: number;            // current sessions / capacity
  sessions: number;        // live sessions count
  latencyMs?: number;      // last health check ms
  online: boolean;
  role: HostRole;
  version: string;
  createdAt: number;
  lastSeen: number;        // heartbeat timestamp
  publicUrl?: string;      // http health url
}

export interface RegisterPayload {
  id?: string;
  name?: string;
  host?: string;
  port?: number;
  wssUrl?: string;
  duckdnsUrl?: string;
  region?: string;
  country?: string;
  flag?: string;
  capacity?: number;
  version?: string;
  publicUrl?: string;
}

export interface HostListResponse {
  main: {
    id: string;
    host: string;
    port: number;
    wssUrl: string;
    role: 'main';
    name: string;
    version: string;
  };
  hosts: HostEntry[];      // available sub-hosts (online only by default)
  total: number;           // total registered (including offline if ?all=1)
  online: number;
  updatedAt: number;
}
