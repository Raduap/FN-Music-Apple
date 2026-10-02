// 端到端冒烟测试：启动模拟服务器与打包后的 Electron 应用，走一遍登录、浏览、播放、喜欢、重启恢复。
// 运行：npm run build && npm run test:e2e（Linux 无显示器时用 xvfb-run）
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { _electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '..')
const PORT = String(15000 + Math.floor(Math.random() * 5000))
const SERVER = `127.0.0.1:${PORT}`
const userData = mkdtempSync(join(tmpdir(), 'fnm-e2e-'))
let mock, app, win

// 主窗口与悬浮球窗口在主进程中的状态
const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ ball: w.webContents.getURL().includes('ball.html'), visible: w.isVisible() })))
const mainVisible = async () => (await windows()).find((w) => !w.ball)?.visible
const ballVisible = async () => !!(await windows()).find((w) => w.ball)?.visible
const closeMain = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('ball.html')).close())
async function ballPage() {
  for (let i = 0; i < 100; i++) {
    const p = app.windows().find((w) => w.url().includes('ball.html'))
    if (p) return p
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('悬浮球窗口没有出现')
}
const until = async (fn, msg) => {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)) }
  assert.fail(msg)
}

async function launch() {
  app = await _electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, NODE_ENV: 'production', FNM_USER_DATA: userData },
  })
  await app.firstWindow()
  // 主窗口（悬浮球是另一个窗口）
  for (let i = 0; i < 100 && !(win = app.windows().find((w) => !w.url().includes('ball.html'))); i++) await new Promise((r) => setTimeout(r, 100))
  win.setDefaultTimeout(15000)
}

before(async () => {
  // 写请求延迟 500ms，确保界面的乐观更新先于服务器写入完成，能稳定暴露读写竞态
  mock = spawn(process.execPath, [join(root, 'dev/mock-server.js')], { env: { ...process.env, PORT, MOCK_WRITE_DELAY: '500' }, stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise((resolve, reject) => {
    mock.stdout.on('data', (d) => String(d).includes('已启动') && resolve())
    mock.on('exit', (c) => reject(new Error('模拟服务器退出：' + c)))
  })
  await launch()
})

after(async () => {
  await app?.close().catch(() => {})
  mock?.kill()
  rmSync(userData, { recursive: true, force: true })
})

test('NAS 账号登录（OAuth）', async () => {
  await win.getByPlaceholder(/192\.168/).fill(SERVER)
  await win.getByText('已找到 MOCK-NAS').waitFor()
  const [oauth] = await Promise.all([app.waitForEvent('window'), win.getByRole('button', { name: '使用 NAS 账号登录' }).click()])
  await oauth.getByPlaceholder('用户名').fill('admin')
  await oauth.getByPlaceholder('密码').fill('x')
  await oauth.getByRole('button', { name: '登录' }).click()
  await win.getByRole('heading', { name: '主页' }).waitFor()
  await win.getByText('最近添加').first().waitFor()
})

test('浏览歌曲并播放', async () => {
  await win.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '歌曲', exact: true }).click()
  await win.getByRole('heading', { name: '歌曲' }).waitFor()
  const first = win.getByRole('row').nth(1)
  const title = await first.locator('.t1').innerText()
  await first.dblclick()
  const bar = win.getByRole('contentinfo', { name: '播放器' })
  await bar.locator('.pb-title').getByText(title, { exact: true }).waitFor()
  await bar.getByRole('button', { name: '暂停', exact: true }).waitFor()
  await win.waitForFunction(() => !document.title.startsWith('⏸') && document.title !== '飞牛音乐')
})

test('歌词面板显示同步歌词', async () => {
  await win.keyboard.press('Control+L')
  await win.locator('.sidepanel .lyrics.synced .lyric-line').first().waitFor()
  await win.keyboard.press('Control+L')
})

test('喜欢歌曲后出现在“喜欢的歌曲”中', async () => {
  const bar = win.getByRole('contentinfo', { name: '播放器' })
  const title = await bar.locator('.pb-title').innerText()
  await bar.getByRole('button', { name: '喜欢', exact: true }).click()
  await bar.getByRole('button', { name: '取消喜欢' }).waitFor()
  await win.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '喜欢的歌曲' }).click()
  await win.locator('.songlist .t1').getByText(title, { exact: true }).waitFor()
})

test('搜索', async () => {
  await win.keyboard.press('Control+F')
  await win.keyboard.type('周杰伦')
  await win.getByRole('heading', { name: /周杰伦/ }).waitFor()
  await win.locator('.artist-card, .card').first().waitFor()
})

test('重启后保持登录并恢复播放队列与位置', async () => {
  const bar = win.getByRole('contentinfo', { name: '播放器' })
  await bar.getByRole('slider', { name: '播放进度' }).focus()
  await win.keyboard.press('PageUp') // 前进 20 秒
  await bar.getByRole('button', { name: '暂停', exact: true }).click()
  await bar.getByRole('button', { name: '播放', exact: true }).waitFor()
  const title = await bar.locator('.pb-title').innerText()
  await app.close()

  await launch()
  const bar2 = win.getByRole('contentinfo', { name: '播放器' })
  await bar2.locator('.pb-title').getByText(title, { exact: true }).waitFor()
  const pos = await bar2.locator('.pb-time').first().innerText()
  const [m, s] = pos.split(':').map(Number)
  assert.ok(m * 60 + s >= 15, `播放位置应已恢复，实际为 ${pos}`)
  await bar2.getByRole('button', { name: '播放', exact: true }).click()
  await bar2.getByRole('button', { name: '暂停', exact: true }).waitFor()
})

test('封面磁盘缓存：重启后不再向 NAS 请求已显示过的封面', async () => {
  const mockCovers = (method = 'GET') => fetch(`http://${SERVER}/__mock/covers`, { method }).then((r) => r.json())
  // 专辑页首屏中已显示出来的封面（coverId@尺寸）
  const openAlbums = async () => {
    await win.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '专辑', exact: true }).click()
    await win.getByRole('heading', { name: '专辑' }).waitFor()
    await win.waitForFunction(() => document.querySelectorAll('.grid .cover img.loaded').length >= 8)
    return win.evaluate(() => [...document.querySelectorAll('.grid .cover')].filter((c) => c.querySelector('img.loaded')).map((c) => c.dataset.cover))
  }

  const shown = await openAlbums()
  const requested = await mockCovers()
  for (const k of shown) assert.ok(requested.includes(k), `首次显示的封面应来自 NAS：${k}`)

  await mockCovers('DELETE')
  await app.close()
  await launch()
  const shownAgain = await openAlbums()
  const both = shownAgain.filter((k) => shown.includes(k))
  assert.ok(both.length >= 4, `重启后应再次显示之前的封面，实际只有 ${both.length} 张`)
  // 重启前显示过的封面都应来自磁盘缓存；NAS 只会收到之前没显示过的封面请求
  const refetched = (await mockCovers()).filter((k) => shown.includes(k))
  assert.deepEqual(refetched, [], '已缓存的封面不应再向 NAS 请求')
  // 恢复播放，供后面的托盘测试使用
  const bar = win.getByRole('contentinfo', { name: '播放器' })
  await bar.getByRole('button', { name: '播放', exact: true }).click()
  await bar.getByRole('button', { name: '暂停', exact: true }).waitFor()
})

test('悬浮球：显示当前歌曲，并能控制播放', async (t) => {
  const bar = win.getByRole('contentinfo', { name: '播放器' })
  const title = await bar.locator('.pb-title').innerText()
  assert.equal(await ballVisible(), false, '默认只在主窗口隐藏时显示')

  await win.evaluate(() => window.fn.setPrefs({ ballMode: 'always' }))
  t.after(() => win.evaluate(() => window.fn.setPrefs({ ballMode: 'hidden' })).catch(() => {}))
  const ball = await ballPage()
  await until(ballVisible, '“始终显示”时应显示悬浮球')
  ball.setDefaultTimeout(15000)
  await ball.locator('.title').getByText(title, { exact: true }).waitFor()

  // 悬停展开，用面板上的按钮控制主窗口里的播放器
  await ball.locator('.orb').hover()
  await ball.locator('.stage[data-expanded]').waitFor()
  const poll = { polling: 250 }
  await ball.getByRole('button', { name: '暂停', exact: true }).click()
  await win.waitForFunction(() => document.title.startsWith('⏸'), null, poll)
  await ball.getByRole('button', { name: '播放', exact: true }).click()
  await win.waitForFunction(() => !document.title.startsWith('⏸'), null, poll)

  const favBefore = await bar.getByRole('button', { name: /喜欢/ }).getAttribute('aria-pressed')
  await ball.locator('.ctrl.fav').click()
  await until(async () => (await bar.getByRole('button', { name: /喜欢/ }).getAttribute('aria-pressed')) !== favBefore, '应切换“喜欢”')

  await ball.getByRole('button', { name: '下一首' }).click()
  await until(async () => (await bar.locator('.pb-title').innerText()) !== title, '应切到下一首')
  const next = await bar.locator('.pb-title').innerText()
  await ball.locator('.title').getByText(next, { exact: true }).waitFor()

  // 滚轮调音量
  const volume = () => win.evaluate(() => JSON.parse(localStorage.getItem('fnm:volume')) ?? 0.8) // 未调过音量时为默认值 0.8
  const vol = await volume()
  await ball.locator('.orb').hover()
  await ball.mouse.wheel(0, 120)
  await until(async () => (await volume()) < vol, '滚轮向下应降低音量')
  await ball.locator('.hud').waitFor()

  // 恢复默认：主窗口可见时隐藏
  await win.evaluate(() => window.fn.setPrefs({ ballMode: 'hidden' }))
  await until(async () => !(await ballVisible()), '“主窗口隐藏时显示”且主窗口可见时应隐藏悬浮球')
})

test('关闭窗口后停留在托盘，音乐继续播放', async () => {
  const info = await win.evaluate(() => window.fn.trayInfo())
  assert.ok(info.available, '应已创建托盘图标')
  await win.evaluate(() => window.fn.setPrefs({ closeToTray: true }))
  await win.waitForFunction(() => !document.title.startsWith('⏸') && document.title !== '飞牛音乐')

  await closeMain()
  assert.equal(await mainVisible(), false, '窗口应隐藏而不是关闭')
  // 默认“主窗口隐藏时显示”悬浮球
  await until(ballVisible, '主窗口隐藏后应显示悬浮球')
  // 窗口隐藏后 requestAnimationFrame 不再触发，waitForFunction 必须改用定时轮询
  const poll = { polling: 250 }
  const before = await win.evaluate(() => document.querySelector('.pb-time').textContent)
  await win.waitForFunction((t) => document.querySelector('.pb-time').textContent !== t, before, poll)

  // 托盘菜单的“暂停”：主进程向渲染进程发送播放控制命令
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('ball.html')).webContents.send('player:command', 'toggle'))
  await win.waitForFunction(() => document.title.startsWith('⏸'), null, poll)

  // 再次启动应用（第二个实例）时调出窗口
  await app.evaluate(({ app }) => app.emit('second-instance'))
  assert.equal(await mainVisible(), true)
  await until(async () => !(await ballVisible()), '主窗口显示后应隐藏悬浮球')
})

test('关闭“最小化到托盘”后，关闭窗口即退出', async () => {
  await win.evaluate(() => window.fn.setPrefs({ closeToTray: false }))
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await closeMain()
  await exited // 悬浮球窗口不应让应用继续留在后台
})
