const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openpath', {
  tunStart: (cfg)=>ipcRenderer.invoke('tun:start', cfg),
  tunStop: ()=>ipcRenderer.invoke('tun:stop'),
  tunStats: ()=>ipcRenderer.invoke('tun:stats'),
  deviceVpn: {
    status: ()=>ipcRenderer.invoke('device-vpn:status'),
    importProfile: ()=>ipcRenderer.invoke('device-vpn:import'),
    removeProfile: ()=>ipcRenderer.invoke('device-vpn:remove'),
    connect: options=>ipcRenderer.invoke('device-vpn:connect', options),
    disconnect: ()=>ipcRenderer.invoke('device-vpn:disconnect'),
  },
  window: {
    minimize: ()=>ipcRenderer.send('window:minimize'),
    maximize: ()=>ipcRenderer.send('window:maximize'),
    close: ()=>ipcRenderer.send('window:close'),
  },
});
