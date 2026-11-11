// 悬浮歌词右键菜单窗口的 preload：只暴露自绘菜单所需的最小接口
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('menuApi', {
  choose: (id) => ipcRenderer.send('menu:choose', id),
  close: () => ipcRenderer.send('menu:close'),
  // 打开瞬间的失焦不算关闭：主进程在菜单显示后（等焦点稳定）再发 'menu:arm'，
  // 之前一律视为未武装，避免 show 时的瞬时 blur 把菜单关掉（表现为「闪一下又出现」）。
  onArm: (cb) => ipcRenderer.on('menu:arm', () => cb()),
  onDisarm: (cb) => ipcRenderer.on('menu:disarm', () => cb()),
})
