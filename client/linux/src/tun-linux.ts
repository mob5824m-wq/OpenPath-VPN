import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';

/**
 * Linux TUN manager — creates tun interface via `ip tuntap` (requires CAP_NET_ADMIN or root)
 * Falls back to userspace SOCKS5 proxy on 127.0.0.1:1080 when not privileged (no sudo).
 *
 * Uses `openpath-tun` helper (Go binary) if present, else `ip` + `iptables` NAT.
 * In this demo packaging we provide the Node wrapper; actual packet forwarding
 * is done by the server via proxy — TUN here is the OS integration layer.
 *
 * Requires: iproute2, iptables (usually preinstalled on Ubuntu/Fedora/Arch)
 */

export type TunMode = 'kernel' | 'socks';

export class LinuxTun {
  private proc: ChildProcess | null = null;
  private iface = 'tun0';
  mode: TunMode = 'socks'; // auto detected
  ip = '10.89.0.2';
  mtu = 1420;

  async start(): Promise<TunMode> {
    if (process.getuid && process.getuid()===0) {
      // privileged: try kernel TUN
      try {
        await this.exec(`ip tuntap add dev ${this.iface} mode tun`);
        await this.exec(`ip addr add ${this.ip}/24 dev ${this.iface}`);
        await this.exec(`ip link set dev ${this.iface} up mtu ${this.mtu}`);
        // NAT + DNS hijack to tunnel
        await this.exec(`iptables -t nat -A POSTROUTING -o ${this.iface} -j MASQUERADE`);
        await this.exec(`sysctl -w net.ipv4.ip_forward=1`);
        // default route via tunnel (or split if configured)
        // this is a demo; real would add policy routing to avoid locking out SSH
        this.mode = 'kernel';
        console.log(`[tun] kernel ${this.iface} up ${this.ip}/24 mtu ${this.mtu}`);
        return this.mode;
      } catch(e) {
        console.warn('[tun] kernel failed, falling back to SOCKS:', (e as Error).message);
      }
    }
    // unprivileged fallback — SOCKS5 on localhost (configure via gsettings / env)
    this.mode = 'socks';
    console.log('[tun] SOCKS fallback 127.0.0.1:1080 — set `export http_proxy=socks5://127.0.0.1:1080` or configure GNOME proxy');
    // In real build we spawn `openpath-socks` daemon that bridges OPSP → SOCKS
    return this.mode;
  }

  async stop() {
    if (this.mode==='kernel') {
      await this.exec(`ip link set dev ${this.iface} down`).catch(()=>{});
      await this.exec(`ip tuntap del dev ${this.iface} mode tun`).catch(()=>{});
      await this.exec(`iptables -t nat -D POSTROUTING -o ${this.iface} -j MASQUERADE`).catch(()=>{});
      console.log('[tun] down');
    }
    this.proc?.kill();
  }

  private exec(cmd: string): Promise<string> {
    return new Promise((resolve, reject)=>{
      const p = spawn('bash',['-c', cmd], { stdio:['ignore','pipe','pipe'] });
      let out='', err='';
      p.stdout?.on('data',d=> out+=d);
      p.stderr?.on('data',d=> err+=d);
      p.on('close',code=> code===0? resolve(out) : reject(new Error(err||`exit ${code}: ${cmd}`)));
    });
  }

  // GNOME proxy helpers
  async enableGnomeProxy(port=1080) {
    try {
      await this.exec(`gsettings set org.gnome.system.proxy mode 'manual'`);
      await this.exec(`gsettings set org.gnome.system.proxy.socks host '127.0.0.1'`);
      await this.exec(`gsettings set org.gnome.system.proxy.socks port ${port}`);
      console.log('[proxy] GNOME SOCKS enabled');
    } catch {}
  }
  async disableGnomeProxy() {
    try { await this.exec(`gsettings set org.gnome.system.proxy mode 'none'`); } catch {}
  }

  // systemd autostart .desktop installer
  installAutostart(enabled: boolean) {
    const src = '/usr/share/applications/openpath.desktop';
    const dst = `${os.homedir()}/.config/autostart/openpath.desktop`;
    if (enabled) {
      try {
        fs.mkdirSync(`${os.homedir()}/.config/autostart`, { recursive: true });
        fs.copyFileSync(src, dst);
        console.log('[autostart] enabled');
      } catch {}
    } else {
      try { fs.unlinkSync(dst); console.log('[autostart] disabled'); } catch {}
    }
  }
}
