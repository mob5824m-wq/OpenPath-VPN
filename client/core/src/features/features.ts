/**
 * Proton-like Features for OpenPath VPN
 * Each feature mirrors Proton VPN so users migrating find settings familiar.
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
  | "stealth";

export interface FeatureMeta {
  id: FeatureId;
  name: string;
  icon: string;
  description: string;
  protonEquivalent: string; // for docs
  defaultValue: any;
  requiresTier?: "free" | "plus";
}

export const featuresCatalog: FeatureMeta[] = [
  {
    id: "secureCore",
    name: "Secure Core",
    icon: "🛡️",
    description: "Double-hop VPN via privacy jurisdiction (Iceland → Switzerland). Defends against network adversaries. Slower but strongest privacy.",
    protonEquivalent: "Secure Core — same",
    defaultValue: false,
    requiresTier: "plus",
  },
  {
    id: "netShield",
    name: "NetShield Ad-blocker",
    icon: "🧱",
    description: "DNS-level blocking: Off / Block malware only / Block malware+ads+trackers. Like Proton NetShield.",
    protonEquivalent: "NetShield",
    defaultValue: 0,
  },
  {
    id: "killSwitch",
    name: "Kill Switch",
    icon: "⛔",
    description: "Block all internet if VPN drops. Standard = drop while reconnecting, Advanced = Always-on — no internet without VPN (airplane-like).",
    protonEquivalent: "Kill Switch / Always-on",
    defaultValue: "off",
  },
  {
    id: "splitTunnel",
    name: "Split Tunneling",
    icon: "↗️",
    description: "Exclude/Include apps or IPs from VPN. e.g., school intranet direct, rest via VPN. Per-profile.",
    protonEquivalent: "Split Tunneling — same UI",
    defaultValue: { mode: "off" },
  },
  {
    id: "portForwarding",
    name: "Port Forwarding",
    icon: "🔌",
    description: "Open incoming port for P2P/gaming (auto-mapped via UPnP on server, random high port).",
    protonEquivalent: "Port Forwarding (P2P servers)",
    defaultValue: false,
  },
  {
    id: "vpnAccelerator",
    name: "VPN Accelerator",
    icon: "🚀",
    description: "BBR + parallel channels + MTU tuning — up to 400% faster as in Proton. On by default.",
    protonEquivalent: "VPN Accelerator — same",
    defaultValue: true,
  },
  {
    id: "alternativeRouting",
    name: "Alternative Routing",
    icon: "🔀",
    description: "If FortiGate blocks primary domain, auto-try GH mirrors / Cloudflare Workers / DGA fallback — always connects.",
    protonEquivalent: "Alternative Routing — anti-censorship",
    defaultValue: true,
  },
  {
    id: "moderateNAT",
    name: "Moderate NAT",
    icon: "🌐",
    description: "NAT type moderate (Proton default). Turn off for strict gaming privacy.",
    protonEquivalent: "Moderate NAT",
    defaultValue: true,
  },
  {
    id: "customDNS",
    name: "Custom DNS",
    icon: "📡",
    description: "Override VPN DNS (default 1.1.1.1 via DoH over TLS). Block FortiGate DNS poison.",
    protonEquivalent: "Custom DNS",
    defaultValue: null,
  },
  {
    id: "ipv6LeakProtection",
    name: "IPv6 Leak Protection",
    icon: "🛡️6",
    description: "Disable IPv6 outside tunnel (FortiGate leaks). On by default.",
    protonEquivalent: "IPv6 leak protection",
    defaultValue: true,
  },
  {
    id: "dnsLeakProtection",
    name: "DNS Leak Protection",
    icon: "🔒",
    description: "All DNS via VPN only — FortiGate cannot see queries.",
    protonEquivalent: "DNS leak protection",
    defaultValue: true,
  },
  {
    id: "alwaysOn",
    name: "Always-on VPN",
    icon: "🔄",
    description: "Reconnect on boot / network change / wake (systemd/autostart + tray). Like Proton Always-on.",
    protonEquivalent: "Always-on VPN",
    defaultValue: false,
  },
  {
    id: "autoConnect",
    name: "Auto-connect",
    icon: "⚡",
    description: "Connect to Fastest / last profile on launch or untrusted Wi-Fi (e.g., SCHOOL-WIFI).",
    protonEquivalent: "Auto-connect",
    defaultValue: null,
  },
  {
    id: "lanConnections",
    name: "Allow LAN",
    icon: "🏠",
    description: "Allow local network (printer, intranet) while VPN is on. Off blocks LAN (more private).",
    protonEquivalent: "Allow LAN connections",
    defaultValue: false,
  },
  {
    id: "stealth",
    name: "Stealth (GhostPath)",
    icon: "👻",
    description: "TLS inside TCP:443 + HTTPS mimic to defeat FortiGate App Control (Fortinet, Lightspeed).",
    protonEquivalent: "Stealth — our FortiGate-hardened protocol",
    defaultValue: true,
  },
];

export interface FeaturesConfig {
  // global (from profile or global settings)
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
  autoConnect: string | null; // profile id
  lanConnections: boolean;
  stealth: boolean;
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
