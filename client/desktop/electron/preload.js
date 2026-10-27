import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('openpath', {
  tunStart: (cfg)=> ipcRenderer.invoke('tun:start', cfg),
  tunStop: ()=> ipcRenderer.invoke('tun:stop'),
  tunStats: ()=> ipcRenderer.invoke('tun:stats'),
});
