/**
 * OpenPath VPN feature catalog.
 * Info-only features (e.g. audits, privacy notes) render as status cards; toggleable ones get controls.
 */

export type FeatureId =
  | "secureCore"
  | "netShield"
  | "killSwitch"
  | "splitTunnel"
  | "portForwarding"
  | "vpnAccelerator"
  | "alternativeRouting"
  | "moderateNAT"
  | "customDNS"
  | "ipv6LeakProtection"
  | "dnsLeakProtection"
  | "alwaysOn"
  | "autoConnect"
  | "lanConnections"
  | "stealth"
  | "maskIP"
  | "swissPrivacy"
  | "noLogs"
  | "torOverVPN"
  | "smartProtocol"
  | "openSource"
  | "unlimitedBandwidth"
  | "strongEncryption"
  | "strongProtocols"
  | "forwardSecrecy"
  | "twoFactor"
  | "independentlyAudited"
  | "fullDiskEncryption"
  | "highSpeed"
  | "wireGuard"
  | "easyToUse"
  | "streaming"
  | "browserExtension"
  | "serversLocations"
  | "customerSupport"
  | "multiPlatform"
  | "unblocking"
  | "p2p"
  | "vpnPlus10"
  | "profilesSupport";

export interface FeatureMeta {
  id: FeatureId;
  name: string;
  icon: string;
  description: string;
  equivalent: string;
  defaultValue: any;
  requiresTier?: "free" | "plus";
  category?: "privacy" | "security" | "performance" | "freedom" | "usability" | "platform";
  infoOnly?: boolean; // show as status, not toggle
}

export const featuresCatalog: FeatureMeta[] = [
  // ── Privacy ──
  {
    id: "maskIP",
    name: "Mask your IP",
    icon: "🎭",
    description: "Hide real IP so sites see VPN exit. Core of OpenPath — all traffic egresses via chosen host.",
    equivalent: "Mask your IP — same",
    defaultValue: true,
    category: "privacy",
    infoOnly: true,
  },
  {
    id: "swissPrivacy",
    name: "Swiss-style Privacy (self-hosted)",
    icon: "🇨🇭",
    description: "You own the server — no third-party logs. Equivalent to Swiss jurisdiction: outside 5/14 eyes when self-hosted at home/VPS.",
    equivalent: "Swiss privacy — self-host ≈ Swiss jurisdiction",
    defaultValue: true,
    category: "privacy",
    infoOnly: true,
  },
  {
    id: "noLogs",
    name: "No-logs Policy",
    icon: "📝‍🚫",
    description: "Server stores no logs by default (memory-only sessions, no disk persist). Verify in server/src code — open source.",
    equivalent: "No-logs policy — same, auditable",
    defaultValue: true,
    category: "privacy",
    infoOnly: true,
  },
  {
    id: "torOverVPN",
    name: "Tor over VPN",
    icon: "🧅",
    description: "Route VPN → Tor: app can open .onion via SOCKS5 proxy at 127.0.0.1:1080 (forwarded via tunnel). Disable for streaming.",
    equivalent: "Tor over VPN — via SOCKS",
    defaultValue: false,
    category: "privacy",
  },
  // ── Security ──
  {
    id: "secureCore",
    name: "Secure Core (Double-hop)",
    icon: "🛡️",
    description: "Double-hop VPN via privacy jurisdiction (Iceland → Switzerland). Defends against network adversaries. Slower but strongest privacy.",
    equivalent: "Secure Core — same",
    defaultValue: false,
    requiresTier: "plus",
    category: "security",
  },
  {
    id: "netShield",
    name: "NetShield Ad-blocker",
    icon: "🧱",
    description: "DNS-level blocking: Off / Block malware only / Block malware+ads+trackers. Like NetShield — uses 1.1.1.1 DoH + blocklists.",
    equivalent: "NetShield",
    defaultValue: 1,
    category: "security",
  },
  {
    id: "killSwitch",
    name: "Kill Switch",
    icon: "⛔",
    description: "Block all internet if VPN drops. Standard = drop while reconnecting, Advanced = Always-on — no internet without VPN.",
    equivalent: "Kill Switch / Always-on",
    defaultValue: "off",
    category: "security",
  },
  {
    id: "dnsLeakProtection",
    name: "DNS Leak Protection",
    icon: "🔒",
    description: "All DNS via VPN only (DoH TLS) — FortiGate cannot see queries. Enforced when NetShield on.",
    equivalent: "DNS leak protection",
    defaultValue: true,
    category: "security",
  },
  {
    id: "ipv6LeakProtection",
    name: "IPv6 Leak Protection",
    icon: "🛡️6",
    description: "Disable IPv6 outside tunnel (FortiGate leaks). On by default.",
    equivalent: "IPv6 leak protection",
    defaultValue: true,
    category: "security",
  },
  {
    id: "strongEncryption",
    name: "Strong Encryption",
    icon: "🔐",
    description: "AES-256-GCM + ChaCha20-Poly1305 + tunnel double-crypto. Forward Secrecy per-session keys.",
    equivalent: "Encryption / Strong Protocols — same stack",
    defaultValue: true,
    category: "security",
    infoOnly: true,
  },
  {
    id: "strongProtocols",
    name: "Strong Protocols",
    icon: "📜",
    description: "WireGuard®-like (fast path /fast) + GhostPath stealth (TLS over TCP:443). Smart Protocol auto-picks best for censorship.",
    equivalent: "Strong Protocols / WireGuard / Smart Protocol",
    defaultValue: true,
    category: "security",
    infoOnly: true,
  },
  {
    id: "forwardSecrecy",
    name: "Forward Secrecy",
    icon: "🔑",
    description: "New key per session via HKDF — past sessions safe even if long-term PSK leaks.",
    equivalent: "Forward Secrecy — same",
    defaultValue: true,
    category: "security",
    infoOnly: true,
  },
  {
    id: "twoFactor",
    name: "Two-factor Auth (Account)",
    icon: "🔐2",
    description: "Protect dashboard/PSK issuance. TOTP via authenticator — optional, stored server-side.",
    equivalent: "Two-factor authentication — same",
    defaultValue: false,
    category: "security",
  },
  {
    id: "independentlyAudited",
    name: "Open-source & Audited",
    icon: "🔍",
    description: "All clients + server open source. Audit via npm run lint, tests/stealth.test.js. Publish audit report in docs/.",
    equivalent: "Open-source / Independently audited — same",
    defaultValue: true,
    category: "security",
    infoOnly: true,
  },
  {
    id: "fullDiskEncryption",
    name: "Full-disk Encryption (Servers)",
    icon: "💾",
    description: "Run server disk-encrypted (LUKS/FileVault/BitLocker). Bare-metal safe — seized disk ≠ data.",
    equivalent: "Full disk encryption — guidance in docs",
    defaultValue: true,
    category: "security",
    infoOnly: true,
  },
  // ── Freedom / Anti-censorship ──
  {
    id: "stealth",
    name: "Stealth (GhostPath)",
    icon: "👻",
    description: "TLS inside TCP:443 + HTTPS mimic to defeat FortiGate App Control (Fortinet, Lightspeed). The ‘Stealth’ equivalent — but self-hosted.",
    equivalent: "Stealth — our FortiGate-hardened protocol",
    defaultValue: true,
    category: "freedom",
  },
  {
    id: "alternativeRouting",
    name: "Alternative Routing",
    icon: "🔀",
    description: "If FortiGate blocks primary domain, auto-try GH mirrors / Cloudflare Workers / DGA fallback — always connects.",
    equivalent: "Alternative Routing — anti-censorship",
    defaultValue: true,
    category: "freedom",
  },
  {
    id: "smartProtocol",
    name: "Smart Protocol",
    icon: "🧠",
    description: "Auto-probe: stealth → fast → DoH → HTTPS-mimic to find best config for current network (school vs home).",
    equivalent: "Smart Protocol — same auto-select",
    defaultValue: true,
    category: "freedom",
  },
  {
    id: "unblocking",
    name: "Bypass Censorship / Unblock Content",
    icon: "🌍",
    description: "Access blocked sites by egressing via uncensored region (pick a sub-host in an allowed country).",
    equivalent: "Unblocking Content / Censorship bypass — same via host choice",
    defaultValue: true,
    category: "freedom",
    infoOnly: true,
  },
  // ── Performance ──
  {
    id: "vpnAccelerator",
    name: "VPN Accelerator",
    icon: "🚀",
    description: "BBR + parallel channels + MTU tuning — up to 400% faster with the Tunnel Booster. On by default. Maps to Home Turbo mode.",
    equivalent: "VPN Accelerator — same",
    defaultValue: true,
    category: "performance",
  },
  {
    id: "highSpeed",
    name: "High-speed (10 Gbps)",
    icon: "⚡",
    description: "Use Home Turbo (plain WS/WireGuard-like) for up to ~500 Mbps self-hosted; stealth ~70 Mbps due to double-crypto. VPS NIC up to 10 Gbps.",
    equivalent: "High-speed — via Turbo path",
    defaultValue: true,
    category: "performance",
    infoOnly: true,
  },
  {
    id: "unlimitedBandwidth",
    name: "Unlimited Bandwidth",
    icon: "♾️",
    description: "No caps, even on free/self-hosted. All sub-hosts share load — add more for scale.",
    equivalent: "Unlimited Bandwidth — same",
    defaultValue: true,
    category: "performance",
    infoOnly: true,
  },
  {
    id: "wireGuard",
    name: "WireGuard® + OpenVPN compatible",
    icon: "🔷",
    description: "Fast path is WireGuard-like modern crypto; generate wg-quick config via /api/wg-config (ChaCha20, Curve25519).",
    equivalent: "WireGuard — compatible via fast path",
    defaultValue: true,
    category: "performance",
    infoOnly: true,
  },
  {
    id: "p2p",
    name: "P2P / Port Forwarding",
    icon: "🔌",
    description: "Open incoming port for P2P/gaming (auto-mapped via UPnP on server, random high port). Enable per-profile.",
    equivalent: "Port Forwarding / P2P support",
    defaultValue: false,
    category: "performance",
  },
  {
    id: "portForwarding",
    name: "Port Forwarding (legacy)",
    icon: "🔌",
    description: "Alias for P2P — kept for backwards compat.",
    equivalent: "Port Forwarding — same",
    defaultValue: false,
    category: "performance",
  },
  // ── Usability ──
  {
    id: "splitTunnel",
    name: "Split Tunneling",
    icon: "↗️",
    description: "Exclude/Include apps or IPs from VPN. e.g., school intranet direct, rest via VPN. Per-profile.",
    equivalent: "Split Tunneling — same UI",
    defaultValue: { mode: "off" },
    category: "usability",
  },
  {
    id: "customDNS",
    name: "Custom DNS",
    icon: "📡",
    description: "Override VPN DNS (default 1.1.1.1 via DoH over TLS). Block FortiGate DNS poison.",
    equivalent: "Custom DNS",
    defaultValue: null,
    category: "usability",
  },
  {
    id: "alwaysOn",
    name: "Always-on VPN",
    icon: "🔄",
    description: "Reconnect on boot / network change / wake (systemd/autostart + tray). Always-on.",
    equivalent: "Always-on VPN",
    defaultValue: false,
    category: "usability",
  },
  {
    id: "autoConnect",
    name: "Auto-connect",
    icon: "⚡",
    description: "Connect to Fastest / last profile on launch or untrusted Wi-Fi (e.g., SCHOOL-WIFI).",
    equivalent: "Auto-connect",
    defaultValue: null,
    category: "usability",
  },
  {
    id: "lanConnections",
    name: "Allow LAN",
    icon: "🏠",
    description: "Allow local network (printer, intranet) while VPN is on. Off blocks LAN (more private).",
    equivalent: "Allow LAN connections",
    defaultValue: false,
    category: "usability",
  },
  {
    id: "easyToUse",
    name: "Easy to use — Quick Connect",
    icon: "👆",
    description: "One tap: pick Fastest / Secure Core / Tor. Connect button + system tray + system notification.",
    equivalent: "Easy to use — same UX",
    defaultValue: true,
    category: "usability",
    infoOnly: true,
  },
  {
    id: "moderateNAT",
    name: "Moderate NAT",
    icon: "🌐",
    description: "NAT type moderate (default). Turn off for strict gaming privacy.",
    equivalent: "Moderate NAT",
    defaultValue: true,
    category: "usability",
  },
  // ── Platforms ──
  {
    id: "multiPlatform",
    name: "All Platforms",
    icon: "🖥️",
    description: "Windows, macOS, Linux (deb/rpm/AppImage), Android (APK/AAB), iOS (PacketTunnel), CLI, Browser extension stub.",
    equivalent: "Supported platforms — same + CLI",
    defaultValue: true,
    category: "platform",
    infoOnly: true,
  },
  {
    id: "vpnPlus10",
    name: "10 Devices",
    icon: "📱",
    description: "One PSK → 10 concurrent sessions (enforced server-side max 10 per user). Family share via sub-hosts.",
    equivalent: "Up to 10 devices — same limit",
    defaultValue: true,
    category: "platform",
    infoOnly: true,
  },
  {
    id: "browserExtension",
    name: "Browser Extensions",
    icon: "🧩",
    description: "Chrome/Firefox proxy mode: only browser traffic via VPN. Use Split Tunneling → Include browser only.",
    equivalent: "Browser Extensions — via split tunnel",
    defaultValue: false,
    category: "platform",
  },
  {
    id: "streaming",
    name: "Streaming",
    icon: "🎬",
    description: "Pick exit near streaming service (US/UK/JP hosts) to bypass geo-blocks. Streaming region picker — choose sub-host region.",
    equivalent: "Streaming — same via host choice",
    defaultValue: true,
    category: "platform",
    infoOnly: true,
  },
  {
    id: "serversLocations",
    name: "Servers & Locations",
    icon: "🌐",
    description: "Self-hosted: you run servers in 140+ possible countries (any VPS). Directory shows your main + sub hosts.",
    equivalent: "Servers & locations — self-hosted fleet",
    defaultValue: true,
    category: "platform",
    infoOnly: true,
  },
  {
    id: "customerSupport",
    name: "Customer Support",
    icon: "💬",
    description: "Docs + GitHub issues + self-host logs. Docs/ covers Fortinet, DuckDNS, hosts, bypass techniques.",
    equivalent: "Customer support — community + docs",
    defaultValue: true,
    category: "platform",
    infoOnly: true,
  },
  {
    id: "profilesSupport",
    name: "Profiles",
    icon: "👤",
    description: "Save server+features as named profiles (School-Fast, Home-Torrent, Secure-Core-Tor) .",
    equivalent: "Profiles — same",
    defaultValue: true,
    category: "platform",
    infoOnly: true,
  },
];

export interface FeaturesConfig {
  secureCore: boolean;
  netShield: 0 | 1 | 2;
  killSwitch: "off" | "standard" | "advanced";
  splitTunnel: { mode: "off" | "exclude" | "include"; apps?: string[]; ips?: string[] };
  portForwarding: boolean;
  vpnAccelerator: boolean;
  alternativeRouting: boolean;
  moderateNAT: boolean;
  customDNS: string[] | null;
  ipv6LeakProtection: boolean;
  dnsLeakProtection: boolean;
  alwaysOn: boolean;
  autoConnect: string | null;
  lanConnections: boolean;
  stealth: boolean;
  // extended
  maskIP: boolean;
  swissPrivacy: boolean;
  noLogs: boolean;
  torOverVPN: boolean;
  smartProtocol: boolean;
  openSource: boolean;
  unlimitedBandwidth: boolean;
  strongEncryption: boolean;
  strongProtocols: boolean;
  forwardSecrecy: boolean;
  twoFactor: boolean;
  independentlyAudited: boolean;
  fullDiskEncryption: boolean;
  highSpeed: boolean;
  wireGuard: boolean;
  easyToUse: boolean;
  streaming: boolean;
  browserExtension: boolean;
  serversLocations: boolean;
  customerSupport: boolean;
  multiPlatform: boolean;
  unblocking: boolean;
  p2p: boolean;
  vpnPlus10: boolean;
  profilesSupport: boolean;
}

export const defaultFeatures: FeaturesConfig = {
  secureCore: false,
  netShield: 1,
  killSwitch: "off",
  splitTunnel: { mode: "off" },
  portForwarding: false,
  vpnAccelerator: true,
  alternativeRouting: true,
  moderateNAT: true,
  customDNS: null,
  ipv6LeakProtection: true,
  dnsLeakProtection: true,
  alwaysOn: false,
  autoConnect: null,
  lanConnections: false,
  stealth: true,
  maskIP: true,
  swissPrivacy: true,
  noLogs: true,
  torOverVPN: false,
  smartProtocol: true,
  openSource: true,
  unlimitedBandwidth: true,
  strongEncryption: true,
  strongProtocols: true,
  forwardSecrecy: true,
  twoFactor: false,
  independentlyAudited: true,
  fullDiskEncryption: true,
  highSpeed: true,
  wireGuard: true,
  easyToUse: true,
  streaming: true,
  browserExtension: false,
  serversLocations: true,
  customerSupport: true,
  multiPlatform: true,
  unblocking: true,
  p2p: false,
  vpnPlus10: true,
  profilesSupport: true,
};

export function describeLevel(level: number | string, id: FeatureId): string {
  if (id === "netShield") {
    if (level === 0) return "Off";
    if (level === 1) return "Block malware";
    if (level === 2) return "Block malware, ads, trackers";
  }
  if (id === "killSwitch") return String(level);
  return String(level);
}
