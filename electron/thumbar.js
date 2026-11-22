// 任务栏缩略图工具栏：鼠标悬停在任务栏图标上时，窗口预览下方显示「上一首 / 播放暂停 / 下一首」。
// 对应 Windows 的 ITaskbarList3 缩略图工具栏，Electron 用 BrowserWindow.setThumbarButtons 暴露；
// 只在 Windows 生效，其他平台静默跳过。
//
// 按钮图标需要 HICON 位图，NativeImage 不支持 SVG，所以仓库里只保留矢量定义（thumbarIcons.js）：
// 主窗口显示后交给渲染进程用 canvas 按各档 DPI 栅格化，再转成 NativeImage 的多表示。
// 任务栏预览的背景跟随 Windows 系统主题（不是应用内主题），深浅两套图形按系统主题选择。
/* global document, Image */
const { nativeTheme, nativeImage } = require('electron')
const { execFileSync } = require('child_process')
const { NAMES, SIZES, COLORS, glyph } = require('./thumbarIcons')

// 在渲染进程里执行：把每个图标、每个 DPI 的 SVG 画到对应尺寸的 canvas，导出 PNG。
// 必须自包含（会以源码字符串注入页面），不能引用本模块的变量。
const RASTERIZE = async (spec) => {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const out = {}
  for (const { name, svgs } of spec) {
    out[name] = {}
    for (const [size, svg] of Object.entries(svgs)) {
      canvas.width = Number(size)
      canvas.height = Number(size)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await img.decode()
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      out[name][size] = canvas.toDataURL('image/png')
    }
  }
  return out
}

// 每个图标 × 每档 DPI 的 SVG 源
function specFor(theme) {
  const color = COLORS[theme]
  return NAMES.map((name) => ({
    name,
    svgs: Object.fromEntries(SIZES.map((size) => [String(size), glyph(name, size, color)])),
  }))
}

// 任务栏预览的背景跟随 Windows 系统主题，不能用 nativeTheme.shouldUseDarkColors
// （它跟随应用内的浅色 / 深色设置）。读注册表 SystemUsesLightTheme（0 = 深色），结果缓存，
// 系统主题变化时失效。
let systemDark = null
function systemPrefersDark() {
  if (systemDark !== null) return systemDark
  if (process.platform !== 'win32') return (systemDark = false)
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'SystemUsesLightTheme'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000,
    })
    const m = out.match(/SystemUsesLightTheme\s+REG_DWORD\s+(?:0x)?([0-9a-f]+)/i)
    systemDark = m ? Number.parseInt(m[1], 16) === 0 : nativeTheme.shouldUseDarkColors
  } catch {
    systemDark = nativeTheme.shouldUseDarkColors
  }
  return systemDark
}

/**
 * @param {(cmd: string) => void} o.command  发送播放控制命令到渲染进程（toggle / prev / next）
 */
function createThumbar({ command }) {
  let target = null
  let player = { title: '', playing: false }
  let applied = ''
  const icons = new Map() // theme -> NativeImage 集合
  const pending = new Map() // theme -> 栅格化中的 Promise

  function toIconSet(out) {
    const set = {}
    for (const name of NAMES) {
      const img = nativeImage.createEmpty()
      for (const [size, url] of Object.entries(out?.[name] || {})) {
        const comma = url.indexOf(',')
        const buf = Buffer.from(url.slice(comma + 1), 'base64')
        img.addRepresentation({ scaleFactor: Number(size) / 16, width: 16, height: 16, buffer: buf })
      }
      set[name] = img.isEmpty() ? null : img
    }
    return set
  }

  // 在主窗口里栅格化当前主题的图标；同一主题并发只做一次
  function load(theme) {
    if (icons.has(theme)) return Promise.resolve(icons.get(theme))
    if (pending.has(theme)) return pending.get(theme)
    if (!target || target.isDestroyed()) return Promise.resolve(null)
    const code = `(${RASTERIZE.toString()})(${JSON.stringify(specFor(theme))})`
    const run = target.webContents
      .executeJavaScript(code, true)
      .then((out) => {
        const set = toIconSet(out)
        icons.set(theme, set)
        return set
      })
      .catch((e) => {
        console.error('[thumbar] 图标栅格化失败：', e.message)
        return null
      })
      .finally(() => pending.delete(theme))
    pending.set(theme, run)
    return run
  }

  function apply(buttons, key) {
    if (!target || target.isDestroyed()) return
    try {
      applied = target.setThumbarButtons(buttons) ? key : ''
    } catch (e) {
      applied = ''
      console.error('[thumbar] 设置缩略图工具栏失败：', e.message)
    }
  }

  // 统一的刷新入口。force=true 用于窗口重建或图标栅格化完成后重新挂按钮
  function sync(force = false) {
    if (process.platform !== 'win32' || !target || target.isDestroyed()) return
    const has = !!player.title
    const theme = systemPrefersDark() ? 'dark' : 'light'
    const key = has ? `${theme}:${player.playing ? 'playing' : 'paused'}` : 'idle'
    if (!force && key === applied) return
    if (!has) {
      apply([], 'idle')
      return
    }
    const set = icons.get(theme)
    if (!set) {
      // 首次显示或切换系统主题：图标栅格化完成后会再次进来
      load(theme).then((loaded) => { if (loaded) sync(true) })
      return
    }
    // 图标缺失时宁可不显示，也不要挂几个空白按钮
    if (!set.prev || !set.play || !set.pause || !set.next) return
    apply([
      { icon: set.prev, tooltip: '上一首', click: () => command('prev') },
      { icon: player.playing ? set.pause : set.play, tooltip: player.playing ? '暂停' : '播放', click: () => command('toggle') },
      { icon: set.next, tooltip: '下一首', click: () => command('next') },
    ], key)
  }

  const onThemeUpdated = () => {
    systemDark = null
    sync(true)
  }
  nativeTheme.on('updated', onThemeUpdated)

  return {
    // 主窗口显示后把按钮挂到它上面；重建窗口时再次调用即可
    attach(win) {
      target = win
      sync(true)
    },
    setPlayer(p) {
      const next = { title: String(p?.title || ''), playing: !!p?.playing }
      if (next.title === player.title && next.playing === player.playing) return
      player = next
      sync()
    },
    destroy() {
      nativeTheme.removeListener('updated', onThemeUpdated)
      target = null
    },
  }
}

module.exports = { createThumbar }
