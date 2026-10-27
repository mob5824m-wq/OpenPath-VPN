// Electron main — platform TUN setup sketch
import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'child_process';
import path from 'path';

let win;
function createWindow(){
  win = new BrowserWindow({
    width: 1100, height: 740,
    title: 'OpenPath VPN — GhostPath',
    webPreferences: { preload: path.join(process.cwd(), 'electron/preload.js'), contextIsolation: true }
  });
  win.loadURL(process.env.VITE_URL || 'http://localhost:5173');
}

app.whenReady().then(createWindow);

// TUN abstraction: on Windows uses wintun.dll, on macOS/linux uses /dev/net/tun + gVisor netstack
// The real binary is `openpath-tun` (Go, compiled via `go build -o openpath-tun ./tun`)
// Here we mock setup for demo packaging
ipcMain.handle('tun:start', async (_e, cfg)=>{
  console.log('[tun] start with', cfg);
  // spawn openpath-tun --psk ... --server wss://...
  return { ok:true, iface:'utun9', ip:'10.89.0.2' };
});
ipcMain.handle('tun:stop', async ()=> ({ ok:true }));
ipcMain.handle('tun:stats', async ()=> ({ rx: 0, tx: 0, rtt: 24 }));
