import { NotificationPayload, VpnStatus, TransferStats, formatBytes, formatSpeed, formatDuration } from "./types";

/**
 * Cross-platform OS notification manager (connect / disconnect / status).
 *
 * Platform adapters:
 *  - Android: ForegroundService + NotificationCompat ongoing:true, actions Disconnect
 *  - iOS: Live Activity (ActivityKit) + persistent banner
 *  - Linux: libnotify persistent (hint:transient false) + systemd notification refresh + tray tooltip
 *  - Windows: Windows Action Center persistent toast + tray balloon (Electron Notification + Tray)
 *  - macOS: NSUserNotification persistent via Electron notifications
 *  - Web: in-app banner (mimics screenshot for preview)
 *
 * Each platform inherits and implements show()/update()/hide() with native APIs.
 * Core polling is in start() — updates every 1s with speed calculation.
 */
export abstract class BaseNotificationManager {
  protected payload: NotificationPayload | null = null;
  protected timer: NodeJS.Timeout | null = null;
  protected lastRx = 0;
  protected lastTx = 0;
  protected lastTick = 0;

  abstract show(p: NotificationPayload): void;
  abstract update(p: NotificationPayload): void;
  abstract hide(): void;

  // Core factory — platform detection
  static createForCurrent(): BaseNotificationManager {
    // Electron renderer will override, web uses WebNotificationManager
    if (typeof window !== "undefined" && (window as any).openpathLinux) return new ElectronNotificationManager();
    // @ts-ignore
    return new WebNotificationManager();
  }

  start(initial: NotificationPayload) {
    this.payload = initial;
    this.lastRx = initial.stats.rxBytes;
    this.lastTx = initial.stats.txBytes;
    this.lastTick = Date.now();
    this.show(initial);
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.hide();
  }

  // Called by VPN engine on new rx/tx
  onStatsUpdate(rxBytes: number, txBytes: number) {
    if (!this.payload) return;
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000 || 1;
    const rxSpeed = Math.max(0, (rxBytes - this.lastRx) / dt);
    const txSpeed = Math.max(0, (txBytes - this.lastTx) / dt);
    this.lastRx = rxBytes;
    this.lastTx = txBytes;
    this.lastTick = now;
    this.payload.stats = {
      rxBytes,
      txBytes,
      rxSpeedBps: rxSpeed,
      txSpeedBps: txSpeed,
      durationSec: this.payload.stats.durationSec + 1,
      connectedSince: this.payload.stats.connectedSince,
    };
    // throttle update to avoid spam — but we update every 1s for smooth speed
    this.update(this.payload);
  }

  setStatus(status: VpnStatus) {
    if (!this.payload) return;
    this.payload.status = status;
    this.update(this.payload);
  }

  protected renderTitle(p: NotificationPayload): string {
    if (p.status !== "connected") return `OpenPath VPN — ${p.status}`;
    const via = p.secureCoreExit ? `via ${p.secureCoreExit.flag} ${p.secureCoreExit.name}` : "";
    return `${p.country.flag} Connected to ${p.country.name} ${via}`.trim();
  }

  protected renderBody(p: NotificationPayload): string {
    if (p.status !== "connected") return `${p.profileName || "Quick Connect"} • ${p.status}`;
    const down = `↓ ${formatBytes(p.stats.rxBytes)} │ ${formatSpeed(p.stats.rxSpeedBps)}`;
    const up = `↑ ${formatBytes(p.stats.txBytes)} │ ${formatSpeed(p.stats.txSpeedBps)}`;
    const dur = formatDuration(p.stats.durationSec);
    return `${down}   ${up}   • ${dur}   ${p.ip ? `• ${p.ip}` : ""}`;
  }

  protected actions(): string[] {
    return ["Disconnect", "Open OpenPath", "Settings"];
  }
}

// ---- Web (browser Notification API via window events) ----
export class WebNotificationManager extends BaseNotificationManager {
  private el: HTMLElement | null = null;

  show(p: NotificationPayload) {
    console.log("[notification] show", p);
    // web uses the browser Notification API — no DOM work here
    // this class logs; actual web UI subscribes via window events
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("openpath:notification", { detail: p }));
  }
  update(p: NotificationPayload) {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("openpath:notification", { detail: p }));
  }
  hide() {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("openpath:notification-hide"));
  }
}

// ---- Electron (Linux/Windows/macOS) ----
export class ElectronNotificationManager extends BaseNotificationManager {
  // Electron main process handles actual native notifications via IPC
  // Renderer just forwards payload
  show(p: NotificationPayload) {
    // @ts-ignore
    if (typeof window !== "undefined" && (window as any).openpathLinux?.notifyShow) {
      // @ts-ignore
      (window as any).openpathLinux.notifyShow(p);
    }
    // notify any renderer listener (no in-app banner is rendered by the app)
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("openpath:notification", { detail: p }));
  }
  update(p: NotificationPayload) {
    // @ts-ignore
    if ((window as any).openpathLinux?.notifyUpdate) (window as any).openpathLinux.notifyUpdate(p);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("openpath:notification", { detail: p }));
  }
  hide() {
    // @ts-ignore
    if ((window as any).openpathLinux?.notifyHide) (window as any).openpathLinux.notifyHide();
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("openpath:notification-hide"));
  }
}

// Factory helper for quick demo payload (like screenshot: Connected to Canada)
export function demoCanadaPayload(): NotificationPayload {
  return {
    status: "connected",
    profileName: "Quick Connect",
    country: { code: "CA", name: "Canada", flag: "🇨🇦", city: "Toronto", serverName: "CA#22", load: 38 },
    stats: {
      rxBytes: 100.94 * 1024 * 1024,
      txBytes: 22.14 * 1024 * 1024,
      rxSpeedBps: 2.16 * 1024,
      txSpeedBps: 2.74 * 1024,
      durationSec: 342,
      connectedSince: Date.now() - 342 * 1000,
    },
    ip: "185.159.157.12",
    protocol: "GhostPath stealth",
    netShieldLevel: 0,
    killSwitch: false,
    showSpeeds: true,
    showVolume: true,
  };
}
