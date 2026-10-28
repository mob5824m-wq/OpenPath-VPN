// Electron shell for the dashboard and the optional native WireGuard VPN.
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
const path = require('path');
const { startDashboardServer } = require('./dashboard-server');
const { registerDeviceVpn } = require('./device-ipc');

let win;
let dashboardServer;
function createWindow(url){
  win = new BrowserWindow({
    width:1100, height:740,
    title:'OpenPath VPN — GhostPath',
    webPreferences:{ preload:path.join(__dirname, 'preload.js'), contextIsolation:true, nodeIntegration:false },
  });
  const openExternal = targetUrl=>{
    try {
      const target = new URL(targetUrl);
      if(target.protocol === 'https:' || target.protocol === 'http:') void shell.openExternal(target.toString());
    } catch {}
  };
  win.webContents.setWindowOpenHandler(({url:target})=>{ openExternal(target); return {action:'deny'}; });
  win.webContents.on('will-navigate', (event, target)=>{
    try { if(new URL(target).origin === new URL(url).origin) return; } catch {}
    event.preventDefault();
    openExternal(target);
  });
  void win.loadURL(url);
}

let dashboardUrl = process.env.VITE_URL || 'http://localhost:5173';
app.whenReady().then(async()=>{
  if(app.isPackaged && !process.env.VITE_URL){
    try {
      const result = await startDashboardServer({
        root:path.join(process.resourcesPath, 'web'),
        backendUrl:process.env.OPENPATH_BACKEND_URL || 'http://127.0.0.1:4433',
        port:Number(process.env.OPENPATH_DASHBOARD_PORT || '34567'),
      });
      dashboardServer = result.server;
      dashboardUrl = result.url;
    } catch(error) {
      dialog.showErrorBox('Could not start OpenPath', error.message);
      app.quit();
      return;
    }
  }
  createWindow(dashboardUrl);
});
app.on('before-quit', ()=>dashboardServer?.close());
app.on('window-all-closed', ()=>{ if(process.platform !== 'darwin') app.quit(); });
app.on('activate', ()=>{ if(BrowserWindow.getAllWindows().length === 0) createWindow(dashboardUrl); else win?.show(); });

function isTrusted(event){
  try {
    return !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
      new URL(event.senderFrame.url).origin === new URL(dashboardUrl).origin;
  } catch { return false; }
}
registerDeviceVpn({ipcMain, app, dialog, safeStorage, getWindow:()=>win, isTrusted});

ipcMain.on('window:minimize', event => { if(isTrusted(event)) win?.minimize(); });
ipcMain.on('window:maximize', event => { if(isTrusted(event) && win) win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.on('window:close', event => { if(isTrusted(event)) win?.close(); });
