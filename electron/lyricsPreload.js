// 悬浮歌词页面可用的接口（与主窗口 / 悬浮球的 preload 分开，只暴露浮窗需要的部分）
const { contextBridge, ipcRenderer } = require('electron')

const listen = (ch) => (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h) }

contextBridge.exposeInMainWorld('lyricsWin', {
  platform: process.platform,
  ready: () => ipcRenderer.send('lyrics:ready'),
  onState: listen('lyrics:state'),
  onStyle: listen('lyrics:style'),
  // 主进程根据胶囊在屏幕上的位置决定控制条在上方还是下方
  onLayout: listen('lyrics:layout'),
  getBackground: () => ipcRenderer.invoke('lyrics:get-background'),
  // 主进程按光标位置驱动控制条显隐：光标进入胶囊为 true
  onActive: listen('lyrics:active'),
  menu: () => ipcRenderer.send('lyrics:menu'),
  openSettings: () => ipcRenderer.send('lyrics:settings'),
  toggleLock: () => ipcRenderer.send('lyrics:toggle-lock'),
  prev: () => ipcRenderer.send('lyrics:prev'),
  toggle: () => ipcRenderer.send('lyrics:toggle'),
  next: () => ipcRenderer.send('lyrics:next'),
  close: () => ipcRenderer.send('lyrics:close'),
  dragStart: () => ipcRenderer.send('lyrics:drag-start'),
  dragMove: () => ipcRenderer.send('lyrics:drag-move'),
  dragEnd: () => ipcRenderer.send('lyrics:drag-end'),
  resizeStart: (dir) => ipcRenderer.send('lyrics:resize-start', dir),
  resizeMove: () => ipcRenderer.send('lyrics:resize-move'),
  resizeEnd: () => ipcRenderer.send('lyrics:resize-end'),
})
