// 系统托盘：关闭主窗口后应用继续在托盘中运行，音乐不中断
const { Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const { trayTooltip, truncate } = require('./util')

const ICON = path.join(__dirname, '..', 'build', 'icon.png')

// 托盘图标：16px，并附带 32px 版本供高 DPI 屏幕使用
function trayIcon() {
  const src = nativeImage.createFromPath(ICON)
  const img = src.resize({ width: 16, height: 16, quality: 'best' })
  img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: src.resize({ width: 32, height: 32, quality: 'best' }).toPNG() })
  return img
}

/**
 * @param {object} o
 * @param {() => void} o.show            显示并聚焦主窗口
 * @param {(cmd: string) => void} o.command  发送播放控制命令到渲染进程（toggle / next / prev）
 * @param {() => boolean} o.getCloseToTray
 * @param {(on: boolean) => void} o.setCloseToTray
 * @param {() => void} o.quit
 */
function createTray({ show, command, getCloseToTray, setCloseToTray, quit }) {
  const tray = new Tray(trayIcon())
  let player = { title: '', artist: '', playing: false }

  const refresh = () => {
    const has = !!player.title
    tray.setToolTip(trayTooltip(player))
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: has ? truncate(`${player.title} — ${player.artist}`, 40) : '未在播放', enabled: false },
      { type: 'separator' },
      { label: player.playing ? '暂停' : '播放', enabled: has, click: () => command('toggle') },
      { label: '上一首', enabled: has, click: () => command('prev') },
      { label: '下一首', enabled: has, click: () => command('next') },
      { type: 'separator' },
      { label: '显示飞牛音乐', click: show },
      { label: '关闭窗口时最小化到托盘', type: 'checkbox', checked: getCloseToTray(), click: (item) => setCloseToTray(item.checked) },
      { type: 'separator' },
      { label: '退出', click: quit },
    ]))
  }

  // Windows 上单击托盘图标打开窗口，右键弹出菜单
  tray.on('click', show)
  tray.on('double-click', show)
  refresh()

  return {
    refresh,
    setPlayer(p) {
      const next = { title: String(p?.title || ''), artist: String(p?.artist || ''), playing: !!p?.playing }
      if (next.title === player.title && next.artist === player.artist && next.playing === player.playing) return
      player = next
      refresh()
    },
    // 仅 Windows 支持气泡通知
    balloon(title, content) {
      if (process.platform === 'win32') tray.displayBalloon({ iconType: 'info', title, content })
    },
    destroy: () => tray.destroy(),
  }
}

module.exports = { createTray }
