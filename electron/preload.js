const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fn', {
  platform: process.platform,
  restore: () => ipcRenderer.invoke('auth:restore'),
  serverInfo: (server) => ipcRenderer.invoke('auth:server-info', { server }),
  login: (payload) => ipcRenderer.invoke('auth:login', payload),
  relogin: () => ipcRenderer.invoke('auth:relogin'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (p) => ipcRenderer.invoke('prefs:set', p),
  setTheme: (mode) => ipcRenderer.send('theme:set', mode),
  setOverlay: (o) => ipcRenderer.send('overlay:set', o),
  onNav: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('nav', h); return () => ipcRenderer.removeListener('nav', h) },
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  close: () => ipcRenderer.send('win:close'),
})
