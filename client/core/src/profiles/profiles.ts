import { Country } from "../notifications/types";

/**
 * Profiles — quick-connect presets + custom profiles.
 * Each profile saves: name, color, icon, country/server, features (Secure Core, NetShield, Kill Switch, etc.) and protocol.
 */

export type ProfileId = string;

export type NetShieldLevel = 0 | 1 | 2; // 0 off, 1 malware only, 2 malware+ads+trackers
export type KillSwitchMode = "off" | "standard" | "advanced"; // advanced = always-on, blocks without VPN

export interface SplitTunnelRule {
  mode: "off" | "exclude" | "include"; // exclude selected apps/IPs from VPN, or only VPN selected
  apps?: string[]; // app bundle ids / .desktop names / exe paths
  ips?: string[]; // CIDRs or IPs
  domains?: string[];
}

export interface Profile {
  id: ProfileId;
  name: string;
  color: string; // hex
  icon: string; // emoji or svg key
  description?: string;
  // Connection target
  country: Country;
  city?: string;
  serverId?: string; // specific server, null = auto fastest in country
  protocol: "auto" | "stealth" | "stealth-fortinet" | "doh";
  stealthProfile: string; // chrome124 / fortinet etc.
  // Feature flags
  secureCore: boolean; // double-hop via privacy jurisdiction
  secureCoreEntry?: Country; // e.g., Iceland → Canada
  netShield: NetShieldLevel;
  killSwitch: KillSwitchMode;
  splitTunnel: SplitTunnelRule;
  portForwarding: boolean;
  vpnAccelerator: boolean; // BBR / turbo
  moderateNAT: boolean;
  customDNS?: string[]; // override DNS
  // Meta
  isSystem: boolean; // cannot delete
  createdAt: number;
  lastUsed?: number;
  isPinned?: boolean;
  // Tags: p2p, streaming, tor
  tags: string[]; // ["p2p","streaming:netflix-us","tor"]
  quickConnect?: boolean; // show on Quick Connect card
}

// Default OpenPath presets for OpenPath
export const defaultProfiles: Profile[] = [
  {
    id: "fastest",
    name: "Fastest",
    color: "#6366f1",
    icon: "⚡",
    description: "Auto-select fastest server (low latency)",
    country: { code: "AQ", name: "Fastest", flag: "⚡", serverName: "auto" },
    protocol: "auto",
    stealthProfile: "chrome124",
    secureCore: false,
    netShield: 1,
    killSwitch: "off",
    splitTunnel: { mode: "off" },
    portForwarding: false,
    vpnAccelerator: true,
    moderateNAT: true,
    isSystem: true,
    createdAt: Date.now(),
    tags: ["quick"],
    quickConnect: true,
  },
  {
    id: "random",
    name: "Random",
    color: "#0ea5e9",
    icon: "🎲",
    description: "Random privacy hop",
    country: { code: "XX", name: "Random", flag: "🌍", serverName: "random" },
    protocol: "auto",
    stealthProfile: "chrome124",
    secureCore: false,
    netShield: 0,
    killSwitch: "off",
    splitTunnel: { mode: "off" },
    portForwarding: false,
    vpnAccelerator: true,
    moderateNAT: true,
    isSystem: true,
    createdAt: Date.now(),
    tags: [],
  },
  {
    id: "secure-core-ch",
    name: "Secure Core",
    color: "#10b981",
    icon: "🛡️",
    description: "Double-hop via Iceland → Switzerland (privacy jurisdiction)",
    country: { code: "CH", name: "Switzerland", flag: "🇨🇭", city: "Zurich", serverName: "CH#12", load: 28 },
    protocol: "stealth",
    stealthProfile: "chrome124",
    secureCore: true,
    secureCoreEntry: { code: "IS", name: "Iceland", flag: "🇮🇸", city: "Reykjavik" },
    netShield: 2,
    killSwitch: "advanced",
    splitTunnel: { mode: "off" },
    portForwarding: false,
    vpnAccelerator: true,
    moderateNAT: false,
    isSystem: true,
    createdAt: Date.now(),
    tags: ["secure-core"],
    quickConnect: true,
  },
  {
    id: "streaming-us",
    name: "Streaming • US",
    color: "#f59e0b",
    icon: "🎬",
    description: "Netflix US, Hulu, HBO (streaming-optimized)",
    country: { code: "US", name: "United States", flag: "🇺🇸", city: "New York", serverName: "US-NY#08", load: 54 },
    protocol: "stealth-fortinet",
    stealthProfile: "fortinet",
    secureCore: false,
    netShield: 0,
    killSwitch: "off",
    splitTunnel: { mode: "off" },
    portForwarding: false,
    vpnAccelerator: true,
    moderateNAT: true,
    isSystem: true,
    createdAt: Date.now(),
    tags: ["streaming:netflix-us", "streaming"],
  },
  {
    id: "streaming-uk",
    name: "Streaming • UK",
    color: "#f59e0b",
    icon: "🎬",
    description: "BBC iPlayer, Netflix UK",
    country: { code: "GB", name: "United Kingdom", flag: "🇬🇧", city: "London", serverName: "GB#03", load: 61 },
    protocol: "stealth-fortinet",
    stealthProfile: "fortinet",
    secureCore: false,
    netShield: 0,
    killSwitch: "off",
    splitTunnel: { mode: "off" },
    portForwarding: false,
    vpnAccelerator: true,
    moderateNAT: true,
    isSystem: true,
    createdAt: Date.now(),
    tags: ["streaming:bbc", "streaming"],
  },
  {
    id: "p2p-nl",
    name: "P2P",
    color: "#8b5cf6",
    icon: "⬇️",
    description: "Torrenting / P2P optimized (Netherlands)",
    country: { code: "NL", name: "Netherlands", flag: "🇳🇱", city: "Amsterdam", serverName: "NL#05", load: 47 },
    protocol: "stealth",
    stealthProfile: "chrome124",
    secureCore: false,
    netShield: 1,
    killSwitch: "advanced",
    splitTunnel: { mode: "off" },
    portForwarding: true, // OpenPath supports port forward on P2P
    vpnAccelerator: true,
    moderateNAT: false,
    isSystem: true,
    createdAt: Date.now(),
    tags: ["p2p"],
  },
  {
    id: "tor",
    name: "Tor over VPN",
    color: "#111827",
    icon: "🧅",
    description: "Route via Tor exit after VPN (dark web)",
    country: { code: "TOR", name: "Tor", flag: "🧅", serverName: "TOR#01" },
    protocol: "stealth",
    stealthProfile: "chrome124",
    secureCore: false,
    netShield: 0,
    killSwitch: "advanced",
    splitTunnel: { mode: "off" },
    portForwarding: false,
    vpnAccelerator: false,
    moderateNAT: false,
    isSystem: true,
    createdAt: Date.now(),
    tags: ["tor"],
  },
  // Fortinet-optimized (school)
  {
    id: "fortinet-school",
    name: "School (Fortinet)",
    color: "#ef4444",
    icon: "🏫",
    description: "FortiGate-hardened: Cloudflare SNI, FortiGuard Business/CDN, explicit proxy CONNECT",
    country: { code: "US", name: "United States", flag: "🇺🇸", serverName: "US#FORTI", load: 22 },
    protocol: "stealth-fortinet",
    stealthProfile: "fortinet",
    secureCore: false,
    netShield: 2,
    killSwitch: "standard",
    splitTunnel: { mode: "off" },
    portForwarding: false,
    vpnAccelerator: true,
    moderateNAT: true,
    isSystem: true,
    createdAt: Date.now(),
    tags: ["fortinet", "stealth"],
    quickConnect: true,
  },
];

// Storage helpers (localStorage for web, file for Electron)
export function loadProfiles(): Profile[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("openpath:profiles") : null;
    if (raw) {
      const saved: Profile[] = JSON.parse(raw);
      // merge with defaults (preserve system profiles updates)
      const defaultsById = new Map(defaultProfiles.map((p) => [p.id, p]));
      const merged = saved.map((p) => (defaultsById.has(p.id) ? { ...defaultsById.get(p.id)!, ...p, isSystem: true } : p));
      // add any missing defaults (after upgrade)
      for (const d of defaultProfiles) if (!merged.find((m) => m.id === d.id)) merged.unshift(d);
      return merged;
    }
  } catch {}
  return [...defaultProfiles];
}

export function saveProfiles(profiles: Profile[]) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem("openpath:profiles", JSON.stringify(profiles));
  } catch {}
}

export function createCustomProfile(base: Partial<Profile> & { name: string; country: Country }): Profile {
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: base.name,
    color: base.color || "#6366f1",
    icon: base.icon || "⭐",
    description: base.description || "Custom profile",
    country: base.country,
    city: base.city,
    serverId: base.serverId,
    protocol: base.protocol || "stealth",
    stealthProfile: base.stealthProfile || "chrome124",
    secureCore: base.secureCore ?? false,
    secureCoreEntry: base.secureCoreEntry,
    netShield: base.netShield ?? 1,
    killSwitch: base.killSwitch || "off",
    splitTunnel: base.splitTunnel || { mode: "off" },
    portForwarding: base.portForwarding ?? false,
    vpnAccelerator: base.vpnAccelerator ?? true,
    moderateNAT: base.moderateNAT ?? true,
    isSystem: false,
    createdAt: Date.now(),
    tags: base.tags || [],
  };
}

// Quick helpers for UI
export function getQuickConnects(profiles: Profile[]): Profile[] {
  return profiles.filter((p) => p.quickConnect);
}
export function getByTag(profiles: Profile[], tag: string): Profile[] {
  return profiles.filter((p) => p.tags.includes(tag) || p.tags.some((t) => t.startsWith(tag)));
}
