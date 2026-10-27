import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('openpathLinux', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (c:any) => ipcRenderer.invoke('config:set', c),
  connect: (opts:any) => ipcRenderer.invoke('vpn:connect', opts),
  disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  status: () => ipcRenderer.invoke('vpn:status'),
  logs: (cb:(s:string)=>void) => ipcRenderer.on('log', (_e, s)=> cb(s)),
  tun: {
    start: () => ipcRenderer.invoke('tun:start'),
    stop: () => ipcRenderer.invoke('tun:stop'),
    mode: () => ipcRenderer.invoke('tun:mode'),
  },
  // shared with desktop
  tunStart: (cfg:any) => ipcRenderer.invoke('tun:start', cfg),
  tunStop: () => ipcRenderer.invoke('tun:stop'),
});
