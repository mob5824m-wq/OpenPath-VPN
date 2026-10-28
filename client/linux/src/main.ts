import { app, BrowserWindow, ipcMain, Tray, dialog, safeStorage, shell } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { loadConfig, saveConfig } from './config';
import { createTray } from './tray';
import { WebSocketSession } from './session';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function isRendererUrl(value:string):boolean {
  try {
    const current = new URL(value);
    if(process.env.VITE_URL) return current.origin === new URL(process.env.VITE_URL).origin;
    const expected = pathToFileURL(path.join(__dirname, 'renderer', 'index.html'));
    return current.protocol === 'file:' && current.pathname === expected.pathname;
  } catch { return false; }
}
function isTrusted(event:Electron.IpcMainEvent | Electron.IpcMainInvokeEvent):boolean {
  return !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && isRendererUrl(event.senderFrame.url);
}
function openExternal(value:string) {
  try { const target = new URL(value); if(target.protocol === 'https:' || target.protocol === 'http:') void shell.openExternal(target.toString()); } catch {}
}

const session = new WebSocketSession(
  state => { if(win && !win.isDestroyed()) win.webContents.send('vpn:state', state); },
  message => { if(win && !win.isDestroyed()) win.webContents.send('log', message); },
);

function createWindow() {
  win = new BrowserWindow({
    width:1040, height:720, minWidth:700, minHeight:500,
    title:'OpenPath VPN — Linux', backgroundColor:'#0f172a',
    webPreferences:{ preload:path.join(__dirname, 'preload.js'), contextIsolation:true, nodeIntegration:false },
    titleBarStyle:'hiddenInset', autoHideMenuBar:true,
  });
  win.webContents.setWindowOpenHandler(({url})=>{ openExternal(url); return {action:'deny'}; });
  win.webContents.on('will-navigate', (event, url)=>{
    if(isRendererUrl(url)) return;
    event.preventDefault(); openExternal(url);
  });
  const devUrl = process.env.VITE_URL;
  if(devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', event => {
    if(!quitting && tray){ event.preventDefault(); win?.hide(); }
  });
  try { tray = createTray(win); }
  catch(error) { console.warn('[tray] unavailable:', (error as Error).message); }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if(process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if(BrowserWindow.getAllWindows().length === 0) createWindow(); else win?.show(); });
app.on('before-quit', () => { quitting = true; session.disconnect(); tray?.destroy(); tray = null; });

ipcMain.on('window:minimize', event => { if(isTrusted(event)) win?.minimize(); });
ipcMain.on('window:maximize', event => { if(isTrusted(event) && win) win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.on('window:close', event => { if(isTrusted(event)) app.quit(); });

function secureHandle(channel:string, action:(...args:any[])=>unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if(!isTrusted(event)) throw new Error('Controls are restricted to the OpenPath window');
    return action(...args);
  });
}
secureHandle('config:get', () => loadConfig());
secureHandle('config:set', config => { saveConfig(config); return {ok:true}; });
secureHandle('vpn:connect', opts => {
  const cfg = loadConfig();
  return session.connect({ serverUrl:opts?.serverUrl ?? cfg.serverUrl, psk:opts?.psk ?? cfg.psk, user:opts?.user ?? cfg.user });
});
secureHandle('vpn:disconnect', () => { session.disconnect(); return {ok:true}; });
secureHandle('vpn:status', () => session.status());

// Share the audited WireGuard integration with the cross-platform desktop shell.
// Packaged builds copy these files into resources/native; development uses source.
const nativePath = app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'device-ipc.js')
  : path.join(__dirname, '../../desktop/electron/device-ipc.js');
const { registerDeviceVpn } = require(nativePath) as { registerDeviceVpn:(options:any)=>void };
registerDeviceVpn({
  ipcMain, app, dialog, safeStorage, getWindow:()=>win, isTrusted,
});
