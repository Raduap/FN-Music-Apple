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

async function launch() {
  app = await _electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, NODE_ENV: 'production', FNM_USER_DATA: userData },
  })
  win = await app.firstWindow()
  win.setDefaultTimeout(15000)
}

before(async () => {
  mock = spawn(process.execPath, [join(root, 'dev/mock-server.js')], { env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'inherit'] })
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
