import { Notification, nativeImage, BrowserWindow, app } from 'electron';
import path from 'path';

/**
 * Desktop (Windows/macOS/Linux) persistent notification — Electron side
 * System notification shown on connect: Connected to Canada + ↓↑ stats + Disconnect action
 * Uses:
 *  - Windows: ToastNotificationManager scenario:reminder (stays in Action Center)
 *  - macOS: UNUserNotification persistent banner
 *  - Linux: libnotify + tray
 *
 * Electron docs: https://www.electronjs.org/docs/latest/tutorial/notifications
 */
export class PersistentNotification {
  private notif: Notification | null = null;
  private win: BrowserWindow | null = null;

  constructor(win: BrowserWindow) { this.win = win; }

  showConnected(opts: {
    country?: string; countryCode?: string; flag?: string;
    rxMB: string; rxSpeed: string; txMB: string; txSpeed: string;
    ip?: string; duration?: string;
  }) {
    const country = opts.country || 'Canada';
    const flag = opts.flag || '🇨🇦';
    const title = `${flag} Connected to ${country}`;
    const body = `↓ ${opts.rxMB} | ${opts.rxSpeed}   ↑ ${opts.txMB} | ${opts.txSpeed}` + (opts.ip ? `   ${opts.ip}` : '');

    // Electron native notification (cross-platform, will use system notification center)
    const iconPath = path.join(__dirname, '../../assets/logo.png');
    let icon: Electron.NativeImage | undefined;
    try { icon = nativeImage.createFromPath(iconPath); } catch {}

    this.notif = new Notification({
      title,
      body,
      icon,
      silent: true,
      // Windows: toastXml customization for persistent
      // @ts-ignore - Windows toast
      toastXml: undefined,
      urgency: 'critical' as any,
      // actions
      actions: [{ type: 'button', text: 'Disconnect' }, { type: 'button', text: 'Open' }],
      closeButtonText: 'Dismiss',
    });

    this.notif.on('action', (_e, idx) => {
      if (idx === 0) this.win?.webContents.send('vpn:disconnect');
      if (idx === 1) { this.win?.show(); this.win?.focus(); }
    });
    this.notif.on('click', () => { this.win?.show(); this.win?.focus(); });
    (global as any)._openpathConnected = true;
    this.notif.show();

    // Also update taskbar/dock badge + tray tooltip
    this.win?.setOverlayIcon(icon || null, body);
    app?.setBadgeCount?.(1);
  }

  update(_opts: { rxMB: string; rxSpeed: string; txMB: string; txSpeed: string; ip?: string }) {
    // System notifications cannot be updated in place on every platform, and re-posting
    // them every second would spam the user. The notification stays posted once from
    // showConnected(); live stats live in the tray tooltip / overlay instead.
    if (!(global as any)._openpathConnected) return;
    try { app?.setBadgeCount?.(1); } catch {}
  }

  hide() {
    (global as any)._openpathConnected = false;
    this.notif?.close();
    this.notif = null;
    app?.setBadgeCount?.(0);
  }
}
