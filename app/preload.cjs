// The only things the window may ask of the bridge. No Node, no files, no network from the page itself.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qsl', {
  get: () => ipcRenderer.invoke('get'),
  onStatus: fn => ipcRenderer.on('status', (_, s) => fn(s)),
  onLog: fn => ipcRenderer.on('log', (_, line) => fn(line)),
  copy: text => ipcRenderer.invoke('copy', text),
  unpair: () => ipcRenderer.invoke('unpair'),
  newCode: () => ipcRenderer.invoke('new-code'),
  setAutostart: on => ipcRenderer.invoke('autostart', on),
  openSite: () => ipcRenderer.invoke('open-site'),
  quit: () => ipcRenderer.invoke('quit'),
});
