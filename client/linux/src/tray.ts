import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import path from 'path';

function fallbackIcon(): Electron.NativeImage {
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4);
  for(let y=0; y<size; y++) for(let x=0; x<size; x++){
    const offset = (y * size + x) * 4;
    if((x - 7.5) ** 2 + (y - 7.5) ** 2 <= 49){
      // createFromBitmap expects BGRA pixels.
      pixels[offset] = 255; pixels[offset + 1] = 74; pixels[offset + 2] = 109; pixels[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(pixels, {width:size, height:size});
}

export function createTray(win: BrowserWindow): Tray {
  const iconPath = path.join(__dirname, '../installers/iconTemplate.png');
  let icon = nativeImage.createFromPath(iconPath);
  if(icon.isEmpty()) icon = fallbackIcon();
  const tray = new Tray(icon);
  const send = (channel:string) => {
    win.show();
    if(win.webContents.isLoading()) win.webContents.once('did-finish-load', ()=>win.webContents.send(channel));
    else win.webContents.send(channel);
  };
  tray.setToolTip('OpenPath — WebSocket session');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label:'Show OpenPath', click:()=>win.show() },
    { label:'Connect', click:()=>send('tray:connect') },
    { label:'Disconnect', click:()=>send('tray:disconnect') },
    { type:'separator' },
    { label:'Settings', click:()=>send('tray:settings') },
    { label:'Quit', click:()=>app.quit() },
  ]));
  tray.on('double-click', ()=>win.show());
  return tray;
}
