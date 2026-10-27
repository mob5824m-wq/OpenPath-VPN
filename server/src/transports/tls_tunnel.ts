import tls from 'tls';
import fs from 'fs';
import { config } from '../config.js';

/**
 * TLS Obfuscation: wrap all VPN traffic inside legitimate TLS 1.3 over TCP :443.
 *
 * In production this module creates a real tls.TLSServer with a valid Let's Encrypt cert
 * for your domain (e.g. cdn.openpath.yourdomain.com) so DPI sees standard HTTPS.
 *
 * In this demo we describe the configuration applied to Node's TLS stack
 * and expose helpers to validate fingerprint mimicry.
 *
 * Real deployment:
 *   cert = /etc/letsencrypt/live/cdn.openpath.yourdomain.com/fullchain.pem
 *   key  = /etc/letsencrypt/live/cdn.openpath.yourdomain.com/privkey.pem
 *   node server/dist/index.js  (listens on 443 with TLS, not 4433 plain HTTP)
 *
 * Client side: browser WebSocket already negotiates TLS automatically (wss://).
 * Native clients (Linux / Windows / Go) use custom TLS socket with SNI + ALPN mimicking.
 */

export interface TlsConfig {
  cert?: string;
  key?: string;
  ca?: string;
  sni: string;           // e.g. cdn.openpath.yourdomain.com
  alpn: string[];        // ["h2","http/1.1"]
  stealthProfile: string; // chrome124 | safari17 | firefox128 | meet
}

export const browserProfiles: Record<string, { alpn: string[]; ja3Hint: string; sniHint?: string; fortinetNote?: string }> = {
  chrome124: { alpn: ['h2','http/1.1'], ja3Hint: '771,4865-4866-4867-49195-49199,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0 Chrome124 Win10' },
  safari17:  { alpn: ['h2','http/1.1'], ja3Hint: '771,4865-4866-4867,0-5-10-11-13172-16-27,23-24,0 Safari17 macOS' },
  firefox128:{ alpn: ['h2','http/1.1'], ja3Hint: '771,4865-4867-49195-49199,0-23-65281-10-11-35-16-5-34-51-43-13-45-28-21,29-23-24-25,0 Firefox128' },
  meet:      { alpn: ['h2'], ja3Hint: '771,4865-4867,0-5-10-11-35-16,29-23-24 WebRTC Meet' },
  // Fortinet-optimized: Chrome124 + Cloudflare SNI whitelisted by FortiGuard Business/CDN, QUIC off, cover fetches
  fortinet:  { alpn: ['h2','http/1.1'], ja3Hint: '771,4865-4866-4867-49195-49199,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0 Chrome124 Fortinet (QUIC off, SNI ajax.googleapis.com fallback)', sniHint: 'cdn.openpath.yourdomain.com (via Cloudflare) fallback ajax.googleapis.com/www.gstatic.com', fortinetNote: 'FortiGate App Control sees SSL.BROWSER+Cloudflare Allow; FortiGuard category Business/CDN not Proxy Avoidance; long-lived rotation 5-15 min' },
};

export function tlsOptionsFromEnv(): TlsConfig {
  return {
    cert: process.env.TLS_CERT || undefined,
    key: process.env.TLS_KEY || undefined,
    sni: process.env.TLS_SNI || process.env.OPS_HOST || 'cdn.openpath.example.com',
    alpn: (process.env.TLS_ALPN || 'h2,http/1.1').split(','),
    stealthProfile: process.env.STEALTH_PROFILE || 'chrome124',
  };
}

export function createTlsServerOptions(cfg: TlsConfig): tls.TlsOptions {
  const opts: tls.TlsOptions = {
    ALPNProtocols: cfg.alpn,
    minVersion: 'TLSv1.3' as any,
    // In Node 18+, session ticket + ciphers auto-match modern browsers well enough.
    // For perfect JA3 cloning use utls / custom OpenSSL patch; here we document intent.
    // ciphers, sigalgs, curves left default → Chrome-compatible on Node 20.
  };
  if (cfg.cert && cfg.key) {
    try {
      opts.cert = fs.readFileSync(cfg.cert);
      opts.key = fs.readFileSync(cfg.key);
      if (cfg.ca) opts.ca = fs.readFileSync(cfg.ca);
    } catch (e) {
      console.warn('[tls] Could not load cert/key, falling back to plain HTTP (dev only):', (e as Error).message);
    }
  }
  // SNI callback for multi-tenant fronting (cdn.a.com, cdn.b.com → same origin)
  opts.SNICallback = (servername, cb) => {
    // Real: load per-domain cert from store; demo returns default
    cb(null, tls.createSecureContext({}));
  };
  return opts;
}

/**
 * Demonstrates how Linux native client opens a raw TLS socket mimicking browser.
 * Called from client/linux and client/core tls_tunnel transport.
 *
 * const socket = tls.connect({
 *   host: 'cdn.openpath.example.com', port: 443,
 *   servername: 'cdn.openpath.example.com', // SNI
 *   ALPNProtocols: ['h2','http/1.1'],
 *   minVersion: 'TLSv1.3',
 *   // no client cert; auth is inside OPSP HMAC
 * });
 * socket.write('GET /ops?auth=... HTTP/1.1\r\nUpgrade: websocket\r\n...\r\n');
 */
export function describeClientTlsConnect(sni: string, profile = 'chrome124') {
  const p = browserProfiles[profile] || browserProfiles.chrome124;
  return `tls.connect({ host: '${sni}', servername: '${sni}', ALPNProtocols: ${JSON.stringify(p.alpn)}, minVersion: 'TLSv1.3' }) // mimics ${profile}${p.fortinetNote ? ' — ' + p.fortinetNote : ''}`;
}

// Fortinet helper: detect FortiGate CA issuer, recommend BYOD if deep-inspection
export function isFortiGateIssuer(issuer: string): boolean {
  return /FortiGate|Fortinet|FG[0-9]|FortiAuthenticator/i.test(issuer);
}
