// 悬浮歌词右键菜单窗口的 preload：只暴露自绘菜单所需的最小接口
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('menuApi', {
  choose: (id) => ipcRenderer.send('menu:choose', id),
  resize: (width, height) => ipcRenderer.send('menu:resize', width, height),
  close: () => ipcRenderer.send('menu:close'),
})
