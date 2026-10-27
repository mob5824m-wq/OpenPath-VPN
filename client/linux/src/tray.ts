import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import path from 'path';

export function createTray(win: BrowserWindow): Tray {
  // Use template icon (monochrome) on Linux for proper dark/light tray
  const iconPath = path.join(__dirname, '../installers/iconTemplate.png');
  let icon: Electron.NativeImage;
  try { icon = nativeImage.createFromPath(iconPath); } catch { icon = nativeImage.createEmpty(); }
  if (icon.isEmpty()) {
    // fallback 16x16 generated dot
    icon = nativeImage.createFromBuffer(Buffer.from('')); // placeholder
  }
  const tray = new Tray(icon);
  const context = Menu.buildFromTemplate([
    { label: 'Show OpenPath', click: ()=> win.show() },
    { label: 'Connect', click: ()=> win.webContents.send('tray:connect') },
    { label: 'Disconnect', click: ()=> win.webContents.send('tray:disconnect') },
    { type: 'separator' },
    { label: 'Settings', click: ()=> win.webContents.send('tray:settings') },
    { label: 'Quit', click: ()=> app.quit() },
  ]);
  tray.setToolTip('OpenPath VPN — stealth over TLS :443');
  tray.setContextMenu(context);
  tray.on('double-click', ()=> win.show());
  return tray;
}
