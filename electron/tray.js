// 系统托盘：关闭主窗口后应用继续在托盘中运行，音乐不中断
const { Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { trayTooltip, truncate } = require('./util')

const BUILD = path.join(__dirname, '..', 'build')
// Windows 托盘在 100% / 125% / 150% / 200% / 250% / 300% 缩放下的实际像素
const SCALES = [[1, 16], [1.25, 20], [1.5, 24], [2, 32], [2.5, 40], [3, 48]]

// 托盘图标：每个缩放比例使用单独渲染的 PNG（scripts/gen-tray-icons.mjs 生成），任何 DPI 下都清晰；
// 缺文件时退回到从应用图标缩小
function trayIcon() {
  const img = nativeImage.createEmpty()
  for (const [scaleFactor, px] of SCALES) {
    const file = path.join(BUILD, 'tray', `tray-${px}.png`)
    if (fs.existsSync(file)) img.addRepresentation({ scaleFactor, width: 16, height: 16, buffer: fs.readFileSync(file) })
  }
  if (!img.isEmpty()) return img
  return nativeImage.createFromPath(path.join(BUILD, 'icon.png')).resize({ width: 16, height: 16, quality: 'best' })
}

const BALL_MODES = [['always', '始终显示'], ['hidden', '主窗口隐藏时显示'], ['off', '关闭']]

/**
 * @param {object} o
 * @param {() => void} o.show            显示并聚焦主窗口
 * @param {(cmd: string) => void} o.command  发送播放控制命令到渲染进程（toggle / next / prev / favorite）
 * @param {() => boolean} o.getCloseToTray
 * @param {(on: boolean) => void} o.setCloseToTray
 * @param {() => string} o.getBallMode
 * @param {(mode: string) => void} o.setBallMode
 * @param {(coverId: string) => Promise<Electron.NativeImage | null>} o.coverImage  当前歌曲封面（用于菜单）
 * @param {() => void} o.quit
 */
function createTray({ show, command, getCloseToTray, setCloseToTray, getBallMode, setBallMode, coverImage, quit }) {
  const tray = new Tray(trayIcon())
  let player = { title: '', artist: '', coverId: '', playing: false, favorite: false }
  let cover = null // 当前歌曲的封面缩略图（菜单图标）

  const refresh = () => {
    const has = !!player.title
    tray.setToolTip(trayTooltip(player))
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: has ? truncate(`${player.title} — ${player.artist}`, 40) : '未在播放', icon: has && cover ? cover : undefined, enabled: false },
      { type: 'separator' },
      { label: player.playing ? '暂停' : '播放', enabled: has, click: () => command('toggle') },
      { label: '上一首', enabled: has, click: () => command('prev') },
      { label: '下一首', enabled: has, click: () => command('next') },
      { label: player.favorite ? '取消喜欢' : '喜欢', enabled: has, click: () => command('favorite') },
      { type: 'separator' },
      { label: '显示飞牛音乐', click: show },
      {
        label: '悬浮球',
        submenu: BALL_MODES.map(([mode, label]) => ({ label, type: 'radio', checked: getBallMode() === mode, click: () => setBallMode(mode) })),
      },
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
      const next = { title: String(p?.title || ''), artist: String(p?.artist || ''), coverId: String(p?.coverId || ''), playing: !!p?.playing, favorite: !!p?.favorite }
      if (Object.keys(next).every((k) => next[k] === player[k])) return
      const coverChanged = next.coverId !== player.coverId
      player = next
      if (coverChanged) {
        cover = null
        const id = next.coverId
        if (id) coverImage(id).then((img) => { if (img && player.coverId === id) { cover = img; refresh() } }).catch(() => {})
      }
      refresh()
    },
    // 仅 Windows 支持气泡通知
    balloon(title, content) {
      if (process.platform === 'win32') tray.displayBalloon({ iconType: 'info', title, content })
    },
    destroy: () => tray.destroy(),
  }
}

module.exports = { createTray, BALL_MODES }
