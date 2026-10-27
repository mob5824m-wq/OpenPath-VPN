export type VpnStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export interface Country {
  code: string; // ISO2
  name: string;
  flag: string; // emoji or url
  city?: string;
  serverId?: string;
  serverName?: string;
  load?: number; // 0-100
  tier?: "free" | "plus" | "secure-core";
  features?: string[]; // ["p2p","tor","streaming","secure-core"]
}

export interface TransferStats {
  rxBytes: number;
  txBytes: number;
  rxSpeedBps: number; // bytes per sec
  txSpeedBps: number;
  durationSec: number;
  connectedSince?: number; // epoch ms
}

export interface NotificationPayload {
  status: VpnStatus;
  profileName?: string;
  country: Country;
  stats: TransferStats;
  // Proton-like extra
  secureCoreExit?: Country;
  ip?: string; // visible exit IP
  protocol?: string; // stealth, wireguard-like, etc.
  netShieldLevel?: number; // 0-2
  killSwitch?: boolean;
  // actions
  showSpeeds: boolean;
  showVolume: boolean;
}

export interface NotificationAction {
  id: "disconnect" | "open" | "settings" | "snooze";
  label: string;
}

export const defaultCountryCanada: Country = {
  code: "CA",
  name: "Canada",
  flag: "🇨🇦",
  city: "Toronto",
  serverName: "CA#14",
  load: 42,
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
export function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(2)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
}
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
