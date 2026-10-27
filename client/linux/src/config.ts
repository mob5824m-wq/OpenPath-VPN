import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AppConfig {
  serverUrl: string;
  user: string;
  psk: string;
  stealthProfile: 'chrome124'|'safari17'|'firefox128'|'meet';
  jitter: boolean;
  padding: boolean;
  domainFront: boolean;
  autostart: boolean;
  killSwitch: boolean;
  splitTunnel?: string[]; // CIDRs to bypass VPN (school intranet)
}

const CONFIG_PATH = path.join(os.homedir(), '.config', 'openpath', 'config.json');

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf-8'));
  } catch {}
  return {
    serverUrl: 'wss://cdn.openpath.example.com/ops',
    user: 'demo',
    psk: 'demo-student-key-do-not-use-prod',
    stealthProfile: 'chrome124',
    jitter: true,
    padding: true,
    domainFront: false,
    autostart: false,
    killSwitch: false,
  };
}
export function saveConfig(c: AppConfig) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c,null,2));
  // also set permissions 600 (contains PSK)
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch {}
}
export function configPath() { return CONFIG_PATH; }
