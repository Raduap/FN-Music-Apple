const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fn', {
  platform: process.platform,
  restore: () => ipcRenderer.invoke('auth:restore'),
  serverInfo: (server) => ipcRenderer.invoke('auth:server-info', { server }),
  login: (payload) => ipcRenderer.invoke('auth:login', payload),
  relogin: () => ipcRenderer.invoke('auth:relogin'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  coverCacheStats: () => ipcRenderer.invoke('covers:stats'),
  clearCoverCache: () => ipcRenderer.invoke('covers:clear'),
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (p) => ipcRenderer.invoke('prefs:set', p),
  setTheme: (mode) => ipcRenderer.send('theme:set', mode),
  setOverlay: (o) => ipcRenderer.send('overlay:set', o),
  trayInfo: () => ipcRenderer.invoke('tray:info'),
  setPlayerState: (s) => ipcRenderer.send('player:state', s),
  onPlayerCommand: (cb) => { const h = (_e, cmd, arg) => cb(cmd, arg); ipcRenderer.on('player:command', h); return () => ipcRenderer.removeListener('player:command', h) },
  onNav: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('nav', h); return () => ipcRenderer.removeListener('nav', h) },
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  close: () => ipcRenderer.send('win:close'),
})
