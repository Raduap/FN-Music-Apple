// 宣传片素材录制：启动模拟服务器（展示数据）与真实的 Electron 应用，按分镜操作并录下画面
// 每个镜头输出到 promo-build/clips/<镜头>/：逐帧图片 + meta.json（每帧时间、光标轨迹、点击）
// 运行：xvfb-run -a -s "-screen 0 2400x1600x24" node scripts/promo/capture.mjs
import { _electron } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '..', '..')
const OUT = join(root, 'promo-build', 'clips')
const SCALE = 1.5 // 设备像素比：1280×800 的窗口录成 1920×1200
const PORT = '17801'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now() / 1000

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const mock = spawn(process.execPath, [join(root, 'dev/mock-server.js')], { env: { ...process.env, PORT, MOCK_SHOWCASE: '1' }, stdio: 'ignore' })
await sleep(800)
const userData = mkdtempSync(join(tmpdir(), 'promo-'))
writeFileSync(join(userData, 'prefs.json'), JSON.stringify({ bounds: { x: 0, y: 0, width: 1280, height: 800 }, ballMode: 'off', closeToTray: false }))
const app = await _electron.launch({
  executablePath: require('electron'),
  args: [root, '--no-sandbox', `--force-device-scale-factor=${SCALE}`],
  env: { ...process.env, NODE_ENV: 'production', FNM_USER_DATA: userData },
})
const win = await app.firstWindow()
win.setDefaultTimeout(20000)
const cdp = await win.context().newCDPSession(win)

// ---------- 光标：按缓动曲线移动，同时记录轨迹，供后期叠加绘制 ----------
let cursorLog = null
let clickLog = null
const pos = { x: 640, y: 400 }
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
// 按实际经过的时间计算位置：录制时机器较忙、每一步变慢也不会拖长整个动作
async function moveTo(page, x, y, ms = 700) {
  const from = { ...pos }
  const start = Date.now()
  for (;;) {
    const p = Math.min(1, (Date.now() - start) / ms)
    const k = ease(p)
    pos.x = from.x + (x - from.x) * k
    pos.y = from.y + (y - from.y) * k
    await page.mouse.move(pos.x, pos.y)
    cursorLog?.push({ t: now(), x: pos.x, y: pos.y })
    if (p >= 1) break
    await sleep(12)
  }
}
async function moveToEl(page, locator, ms, dx = 0.5, dy = 0.5) {
  const b = await locator.boundingBox()
  await moveTo(page, b.x + b.width * dx, b.y + b.height * dy, ms)
}
async function click(page, { double = false } = {}) {
  clickLog?.push({ t: now(), x: pos.x, y: pos.y })
  if (double) await page.mouse.dblclick(pos.x, pos.y)
  else { await page.mouse.down(); await sleep(70); await page.mouse.up() }
}
async function hold(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) { cursorLog?.push({ t: now(), x: pos.x, y: pos.y }); await sleep(50) }
}

// ---------- 录制一个镜头（屏幕录制：画面有变化时才出帧，后期按时间取最近的一帧） ----------
async function shoot(name, fn) {
  const dir = join(OUT, name)
  mkdirSync(dir, { recursive: true })
  const frames = []
  cursorLog = []
  clickLog = []
  const writes = []
  let seq = 0 // 文件名只增不减，避免与尚未写完的旧帧重名
  const onFrame = (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    const file = `f${String(seq++).padStart(5, '0')}.jpg`
    frames.push({ t: f.metadata.timestamp, file })
    writes.push(writeFile(join(dir, file), Buffer.from(f.data, 'base64'))) // 异步写盘，不阻塞操作脚本
  }
  cdp.on('Page.screencastFrame', onFrame)
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92 })
  await sleep(300)
  // 屏幕录制只在画面变化时出帧，开头那一帧可能是之前缓存的旧画面；先截一张当前画面作为第一帧
  const t0 = now()
  writeFileSync(join(dir, 'first.jpg'), await win.screenshot({ type: 'jpeg', quality: 92 }))
  frames.unshift({ t: t0, file: 'first.jpg' })
  frames.splice(1, frames.length - 1) // 丢掉开始前的旧帧
  cursorLog.push({ t: t0, x: pos.x, y: pos.y })
  await fn()
  const t1 = now()
  await cdp.send('Page.stopScreencast')
  cdp.off('Page.screencastFrame', onFrame)
  await Promise.all(writes)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ t0, t1, scale: SCALE, frames, cursor: cursorLog, clicks: clickLog }))
  console.log(`镜头 ${name}：${(t1 - t0).toFixed(1)}s，${frames.length} 帧`)
  cursorLog = clickLog = null
}

// ---------- 登录并预热（让封面都进缓存，镜头里不出现加载中的骨架屏） ----------
await win.getByPlaceholder(/192\.168/).fill(`127.0.0.1:${PORT}`)
await win.getByRole('button', { name: '使用飞牛音乐独立账号登录' }).click()
await win.getByPlaceholder('飞牛音乐独立账号').fill('demo')
await win.getByPlaceholder('密码').fill('demo')
await win.getByRole('button', { name: '登录', exact: true }).click()
await win.getByRole('heading', { name: '主页' }).waitFor()
const nav = win.getByRole('navigation', { name: '主导航' })
for (const name of ['专辑', '艺人', '主页']) {
  await nav.getByRole('link', { name, exact: true }).click()
  await sleep(2500)
}
await win.evaluate(() => document.querySelector('.content').scrollTo(0, 0))
await sleep(800)

// ---------- 镜头 1：资料库 ----------
await shoot('library', async () => {
  await hold(400)
  const card = win.locator('.shelf .card').nth(1)
  await moveToEl(win, card, 900, 0.5, 0.4)
  await hold(900)
  await moveTo(win, 900, 520, 500)
  for (let i = 0; i < 14; i++) { await win.mouse.wheel(0, 45); cursorLog.push({ t: now(), x: pos.x, y: pos.y }); await sleep(40) }
  await hold(700)
  await moveToEl(win, nav.getByRole('link', { name: '专辑', exact: true }), 900)
  await click(win)
  await hold(1800)
})

// 预备：打开一张专辑并播放，等歌词快要换行
await win.locator('.grid .card').nth(4).click()
await win.locator('.song-row').nth(1).waitFor()
await sleep(1500)

// ---------- 镜头 2：专辑与播放 ----------
await shoot('album', async () => {
  await hold(500)
  await moveToEl(win, win.locator('.song-row').nth(2), 900, 0.3)
  await hold(300)
  await click(win, { double: true })
  await hold(1600)
})
await sleep(4500)

// ---------- 镜头 3：全屏播放页与歌词 ----------
await shoot('player', async () => {
  await hold(300)
  await moveToEl(win, win.locator('.pb-cover'), 800)
  await hold(250)
  await click(win)
  await moveTo(win, 1150, 700, 900)
  await hold(7000)
})
await win.keyboard.press('Escape')
await sleep(1200)

// ---------- 镜头 4：主题色与壁纸 ----------
await shoot('themes', async () => {
  await hold(300)
  await moveToEl(win, win.getByRole('button', { name: '账户菜单' }), 800)
  await click(win)
  await hold(400)
  await moveToEl(win, win.getByText('外观、主题色与壁纸…'), 500)
  await click(win)
  const panel = win.getByRole('dialog', { name: '外观' })
  await panel.waitFor()
  await hold(700)
  for (const name of ['墨绿', '海蓝']) {
    await moveToEl(win, panel.getByRole('radio', { name }), 600)
    await click(win)
    await hold(900)
  }
  await moveToEl(win, panel.getByRole('button', { name: '深色' }), 600)
  await click(win)
  await win.emulateMedia({ colorScheme: 'dark' }) // 无显示器的 Linux 下 nativeTheme 不会传到 prefers-color-scheme
  await hold(1000)
  await moveToEl(win, panel.getByRole('radio', { name: '极光' }), 700)
  await click(win)
  await hold(1200)
  await moveToEl(win, panel.getByRole('button', { name: '完成' }), 700)
  await click(win)
  await moveTo(win, 900, 450, 800)
  await hold(1500)
})

// ---------- 镜头 5：悬浮球（逐帧截图，保留透明背景，后期合成到桌面上） ----------
await win.evaluate(() => window.fn.setPrefs({ ballMode: 'always' }))
let ball
for (let i = 0; i < 100 && !(ball = app.windows().find((w) => w.url().includes('ball.html'))); i++) await sleep(100)
await ball.emulateMedia({ colorScheme: 'dark' })
await sleep(2000)
// 截图一次约 70ms，实时录只有 13fps；把页面动画放慢到 1/3 再录，时间轴按 1/3 换算回来，相当于约 40fps。
// 光标移动、停留也都放慢 3 倍，换算后与实际速度一致
const RATE = 1 / 3
const ballCdp = await ball.context().newCDPSession(ball)
await ballCdp.send('Animation.enable')
await ballCdp.send('Animation.setPlaybackRate', { playbackRate: RATE })
const slow = (ms) => ms / RATE
{
  const dir = join(OUT, 'ball')
  mkdirSync(dir, { recursive: true })
  const frames = []
  cursorLog = []
  clickLog = []
  let shooting = true
  const t0 = now()
  const loop = (async () => {
    while (shooting) {
      const t = now()
      const file = `f${String(frames.length).padStart(5, '0')}.png`
      writeFileSync(join(dir, file), await ball.screenshot({ omitBackground: true }))
      frames.push({ t, file })
    }
  })()
  const bpos = { x: 300, y: 54 } // 球在窗口里的位置（窗口 384×108，球在右侧）
  pos.x = bpos.x - 160; pos.y = bpos.y + 50
  await hold(slow(1200))
  await moveTo(ball, 330, 54, slow(900)) // 移到球上：展开
  await hold(slow(1600))
  await moveToEl(ball, ball.locator('.ctrl.main'), slow(600))
  await click(ball)
  await hold(slow(900))
  await click(ball)
  await hold(slow(700))
  await moveToEl(ball, ball.locator('.ctrl.fav'), slow(500))
  await click(ball)
  await hold(slow(1200))
  await moveTo(ball, 120, 104, slow(700)) // 移开：收起
  await hold(slow(1800))
  shooting = false
  await loop
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ t0, t1: now(), timeScale: RATE, scale: SCALE, frames, cursor: cursorLog, clicks: clickLog, size: [384, 108] }))
  console.log(`镜头 ball：${(now() - t0).toFixed(1)}s，${frames.length} 帧`)
}

await app.close()
mock.kill()
rmSync(userData, { recursive: true, force: true })
