// 悬浮球页面可用的接口（与主窗口的 preload 分开，只暴露悬浮球需要的部分）
const { contextBridge, ipcRenderer } = require('electron')

const listen = (ch) => (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h) }

contextBridge.exposeInMainWorld('ball', {
  platform: process.platform,
  ready: () => ipcRenderer.send('ball:ready'),
  onState: listen('ball:state'),
  onLayout: listen('ball:layout'),
  // 鼠标在球 / 面板上时接收点击，离开后透明区域让鼠标穿透到下面的窗口
  setInteractive: (on) => ipcRenderer.send('ball:interactive', !!on),
  command: (cmd, arg) => ipcRenderer.send('ball:command', cmd, arg),
  menu: () => ipcRenderer.send('ball:menu'),
  dragStart: () => ipcRenderer.send('ball:drag-start'),
  dragMove: () => ipcRenderer.send('ball:drag-move'),
  dragEnd: () => ipcRenderer.send('ball:drag-end'),
})
