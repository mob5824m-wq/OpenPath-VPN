import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('openpath', {
  tunStart: (cfg)=> ipcRenderer.invoke('tun:start', cfg),
  tunStop: ()=> ipcRenderer.invoke('tun:stop'),
  tunStats: ()=> ipcRenderer.invoke('tun:stats'),
  window: {
    minimize: ()=> ipcRenderer.send('window:minimize'),
    maximize: ()=> ipcRenderer.send('window:maximize'),
    close: ()=> ipcRenderer.send('window:close'),
  },
});
