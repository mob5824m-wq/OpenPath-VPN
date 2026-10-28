import http, { type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export type ProxyTarget = { host: string; port: number; protocol: 'tcp'|'udp'|'http'|'https' };
type FetchResult = { status: number; headers: Record<string, string>; body: Buffer; truncated: boolean };

const MAX_RESPONSE_BYTES = 6000;
const REQUEST_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 4;

class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// Do not let a public demo server fetch its own metadata, localhost or LAN services.
// DNS is resolved and checked for every redirect, then pinned to the checked IP.
export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; }
  catch { return false; }
}

async function resolvePublicAddress(hostname: string, remaining: number): Promise<{ address: string; family: number }> {
  if (remaining <= 0) throw new RequestError('Request timed out', 504);
  const host = hostname.replace(/^\[|\]$/g, '');
  const family = isIP(host);
  let timeout: NodeJS.Timeout | undefined;
  try {
    const addresses = family ? [{ address: host, family }] : await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new RequestError('DNS lookup timed out', 504)), remaining); }),
    ]);
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
      throw new RequestError('Private, loopback and reserved addresses are not allowed', 403);
    }
    return addresses[0];
  } finally { if (timeout) clearTimeout(timeout); }
}

function responseHeaders(input: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) if (value !== undefined) result[key] = Array.isArray(value) ? value.join(', ') : String(value);
  return result;
}

async function fetchPublic(url: URL, method: string, headers: Record<string, string>, deadline: number, redirects: number): Promise<FetchResult> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new RequestError('Only HTTP(S) URLs without embedded credentials are allowed');
  }
  const remaining = deadline - Date.now();
  const address = await resolvePublicAddress(url.hostname, remaining);
  const afterDns = deadline - Date.now();
  if (afterDns <= 0) throw new RequestError('Request timed out', 504);
  const requestHeaders: OutgoingHttpHeaders = {
    host: url.host,
    'user-agent': headers['user-agent'] || 'OpenPath-VPN/1.0',
    accept: headers.accept || '*/*',
    'accept-encoding': 'identity',
  };
  // Avoid forwarding cookies, authorization, or connection-control headers to redirects.
  if (headers['accept-language']) requestHeaders['accept-language'] = headers['accept-language'];

  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers: requestHeaders,
      // Connect to the pinned IP while checking the certificate for the real hostname.
      servername: url.hostname.replace(/^\[|\]$/g, ''),
    }, res => {
      const status = res.statusCode || 502;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) { reject(new RequestError('Too many redirects', 502)); return; }
        let next: URL;
        try { next = new URL(res.headers.location, url); }
        catch { reject(new RequestError('Invalid redirect URL', 502)); return; }
        fetchPublic(next, method, headers, deadline, redirects + 1).then(resolve, reject);
        return;
      }
      const parts: Buffer[] = [];
      let received = 0;
      let done = false;
      const finish = (truncated: boolean) => {
        if (done) return;
        done = true;
        resolve({ status, headers: responseHeaders(res.headers), body: Buffer.concat(parts), truncated });
      };
      res.on('data', (chunk: Buffer) => {
        const available = MAX_RESPONSE_BYTES - received;
        parts.push(chunk.subarray(0, available));
        received += Math.min(chunk.length, available);
        if (chunk.length > available) { finish(true); res.destroy(); }
      });
      res.on('end', () => finish(false));
      res.on('error', error => { if (!done) reject(error); });
    });
    // Use a deadline rather than an inactivity timeout so slow streams cannot run forever.
    const timer = setTimeout(() => req.destroy(new RequestError('Request timed out', 504)), afterDns);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}

export async function forwardHttpRequest(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
}): Promise<FetchResult> {
  try {
    const method = (opts.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') throw new RequestError('Only GET and HEAD requests are supported', 405);
    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(opts.headers || {})) if (typeof value === 'string') normalizedHeaders[key.toLowerCase()] = value;
    return await fetchPublic(new URL(opts.url), method, normalizedHeaders, Date.now() + REQUEST_TIMEOUT_MS, 0);
  } catch (error: any) {
    const status = error instanceof RequestError ? error.status : 502;
    const message = error instanceof RequestError ? error.message : 'Could not fetch the requested URL';
    return { status, headers: {}, body: Buffer.from(message), truncated: false };
  }
}

export function canUseRawSocket(): boolean {
  return false; // This web demo does not forward raw IP packets.
}
