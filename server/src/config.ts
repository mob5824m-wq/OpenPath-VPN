export const config = {
  port: parseInt(process.env.PORT || '4433', 10),
  host: process.env.HOST || '0.0.0.0',
  // Main/sub role: main = directory that lists sub-hosts, sub = registers to MAIN_URL
  role: (process.env.ROLE || process.env.OP_ROLE || 'main').toLowerCase() as 'main' | 'sub',
  hostId: process.env.HOST_ID || `main-${process.env.PORT || '4433'}`,
  hostName: process.env.HOST_NAME || 'OpenPath Main',
  publicHost: process.env.PUBLIC_HOST || '',
  mainUrl: process.env.MAIN_URL || process.env.MAIN_HOST || '',
  hostRegion: process.env.HOST_REGION || process.env.REGION || 'home',
  // PSKs are loaded from env or file; map userId -> base64url psk
  psks: (() => {
    try {
      if (process.env.OPSK) return JSON.parse(process.env.OPSK);
    } catch {}
    return {
      // demo user — change in production! Generate via npm run gen-psk
      demo: process.env.DEMO_PSK || 'DEMO_PSK_REPLACE_ME_32B_BASE64URL',
      student: process.env.STUDENT_PSK || 'demo-student-key-do-not-use-prod',
    };
  })() as Record<string, string>,
  opsPath: process.env.OPS_PATH || '/ops',
  fastPath: process.env.FAST_PATH || '/fast',
  vpnMode: (process.env.VPN_MODE || 'dual') as 'dual' | 'stealth' | 'fast',
  decoyTitle: process.env.DECOY_TITLE || 'Alex Rivera — Photography Portfolio',
  logLevel: process.env.LOG_LEVEL || 'info',
  rateLimit: {
    maxBadAuthPerIpPerMin: 5,
    tarpitMs: 5 * 60 * 1000,
  },
  antiReplay: {
    windowMs: 30000,
    cacheSize: 10000,
  },
  egress: {
    // For demo we proxy via fetch; real server uses raw IP forwarding via iptables
    allowAllDestinations: true,
  },
};
