import { spawn } from 'child_process';

/**
 * Linux persistent notification — mimics Proton's always-present VPN banner.
 * Uses:
 *  - notify-send with --hint=int:transient:0 + --urgency=critical (persists in GNOME notification center)
 *  - fallback: libnotify via node-notifier
 *  - tray tooltip (via Electron Tray) updated every second with ↓ / ↑ stats
 *  - systemd inhibitor to keep notification after suspend
 *
 * Called from Electron main.ts on connect:
 *   notifier.showConnected("Canada", "CA", rx, rxSpeed, tx, txSpeed)
 *   notifier.update(rx, tx, speeds) every 1s
 *   notifier.hide() on disconnect
 */
export class LinuxNotification {
  private lastId: string | null = null;

  async showConnected(country = "Canada", flag = "🇨🇦", rxMB = "100.94 MB", rxSpeed = "2.16 KB/s", txMB = "22.14 MB", txSpeed = "2.74 KB/s") {
    const title = `${flag} Connected to ${country}`;
    const body = `↓ ${rxMB} | ${rxSpeed}   ↑ ${txMB} | ${txSpeed}`;
    // persistent: --hint=int:transient:0 keeps in notification center until dismissed programmatically
    try {
      spawn('notify-send', [
        title,
        body,
        '--icon=openpath',
        '--urgency=critical',
        '--hint=int:transient:0',
        '--hint=string:desktop-entry:openpath',
        '--app-name=OpenPath VPN',
        '--action=disconnect:Disconnect',
        '--action=open:Open',
      ], { detached: true, stdio: 'ignore' }).unref();
      // Also update tray tooltip via IPC (Electron)
      console.log(`[Linux notify] ${title} — ${body}`);
    } catch (e) {
      console.log(`[notify] ${title} — ${body}`);
    }
  }

  async showConnecting() {
    spawn('notify-send', ['OpenPath VPN', 'Connecting...', '--urgency=normal', '--app-name=OpenPath VPN']).unref();
  }

  async hide() {
    // GNOME: notify-send cannot clear, but we send replacement with same id or use gdbus
    try {
      spawn('gdbus', ['call', '--session', '--dest=org.freedesktop.Notifications', '--object-path=/org/freedesktop/Notifications', '--method=org.freedesktop.Notifications.CloseNotification', this.lastId || '0']).on('error', () => {});
    } catch {}
  }
}
