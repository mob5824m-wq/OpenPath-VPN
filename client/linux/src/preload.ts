import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('openpathLinux', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (c:any) => ipcRenderer.invoke('config:set', c),
  connect: (opts:any) => ipcRenderer.invoke('vpn:connect', opts),
  disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  status: () => ipcRenderer.invoke('vpn:status'),
  logs: (cb:(s:string)=>void) => { ipcRenderer.on('log', (_e, s)=> cb(s)); },
  onState: (cb:(state:any)=>void) => { ipcRenderer.on('vpn:state', (_e, state)=> cb(state)); },
  onTrayConnect: (cb:()=>void) => { ipcRenderer.on('tray:connect', ()=>cb()); },
  onTrayDisconnect: (cb:()=>void) => { ipcRenderer.on('tray:disconnect', ()=>cb()); },
  onTraySettings: (cb:()=>void) => { ipcRenderer.on('tray:settings', ()=>cb()); },
  deviceVpn: {
    status: () => ipcRenderer.invoke('device-vpn:status'),
    importProfile: () => ipcRenderer.invoke('device-vpn:import'),
    removeProfile: () => ipcRenderer.invoke('device-vpn:remove'),
    connect: (options:any) => ipcRenderer.invoke('device-vpn:connect', options),
    disconnect: () => ipcRenderer.invoke('device-vpn:disconnect'),
  },
  tun: {
    start: () => ipcRenderer.invoke('tun:start'),
    stop: () => ipcRenderer.invoke('tun:stop'),
    mode: () => ipcRenderer.invoke('tun:mode'),
  },
  // shared with desktop
  tunStart: (cfg:any) => ipcRenderer.invoke('tun:start', cfg),
  tunStop: () => ipcRenderer.invoke('tun:stop'),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
});
