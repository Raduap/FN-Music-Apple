// README 界面截图：用展示数据（虚构的艺人、专辑与抽象画封面）启动模拟服务器和真实的应用，拍下各个界面
// 输出到 docs/screenshots/（窗口 1280×800，按 1.5 倍像素拍成 1920×1200）
// 运行：npm run screenshots（Linux 无显示器时：xvfb-run -a -s "-screen 0 2400x1600x24" npm run screenshots）
import { _electron } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '..')
const OUT = join(root, 'docs', 'screenshots')
const PORT = '17803'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

const mock = spawn(process.execPath, [join(root, 'dev/mock-server.js')], { env: { ...process.env, PORT, MOCK_SHOWCASE: '1' }, stdio: 'ignore' })
await sleep(800)
const userData = mkdtempSync(join(tmpdir(), 'shots-'))
writeFileSync(join(userData, 'prefs.json'), JSON.stringify({ bounds: { x: 0, y: 0, width: 1280, height: 800 }, ballMode: 'off', closeToTray: false }))
const app = await _electron.launch({
  executablePath: require('electron'),
  args: [root, '--no-sandbox', '--force-device-scale-factor=1.5'],
  env: { ...process.env, NODE_ENV: 'production', FNM_USER_DATA: userData },
})
try {
  const win = await app.firstWindow()
  win.setDefaultTimeout(20000)
  const shot = async (name) => {
    await win.mouse.move(1270, 790) // 鼠标移到角落，避免悬停效果
    await sleep(600)
    await win.screenshot({ path: join(OUT, name), type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 1280, height: 800 } })
    console.log('截图', name)
  }

  // 登录并预热封面缓存
  await win.getByPlaceholder(/192\.168/).fill(`127.0.0.1:${PORT}`)
  await win.getByRole('button', { name: '使用飞牛音乐独立账号登录' }).click()
  await win.getByPlaceholder('飞牛音乐独立账号').fill('demo')
  await win.getByPlaceholder('密码').fill('demo')
  await win.getByRole('button', { name: '登录', exact: true }).click()
  await win.getByRole('heading', { name: '主页' }).waitFor()
  const nav = win.getByRole('navigation', { name: '主导航' })
  const go = async (name) => { await nav.getByRole('link', { name, exact: true }).click(); await sleep(2000) }
  for (const name of ['专辑', '艺人', '主页']) await go(name)

  // 主页
  await win.evaluate(() => document.querySelector('.content').scrollTo(0, 0))
  await shot('home.jpg')

  // 专辑详情，播放第二首
  await go('专辑')
  await win.locator('.grid .card').nth(4).click()
  await win.locator('.song-row').nth(1).dblclick()
  await sleep(1500)
  await shot('album.jpg')

  // 全屏播放页：等几行歌词过去再拍
  await sleep(5000)
  await win.locator('.pb-cover').click()
  await sleep(1800)
  await shot('player.jpg')
  await win.keyboard.press('Escape')
  await sleep(1000)

  // 外观：墨绿 + 深色 + 林间壁纸
  const openAppearance = async () => {
    await win.getByRole('button', { name: '账户菜单' }).click()
    await win.getByText('外观、主题色与壁纸…').click()
    const panel = win.getByRole('dialog', { name: '外观' })
    await panel.waitFor()
    return panel
  }
  let panel = await openAppearance()
  await panel.getByRole('radio', { name: '墨绿' }).click()
  await panel.getByRole('button', { name: '深色' }).click()
  await win.emulateMedia({ colorScheme: 'dark' }) // 无显示器的 Linux 下 nativeTheme 不会传到 prefers-color-scheme
  await panel.getByRole('radio', { name: '林间' }).click()
  await panel.getByRole('button', { name: '完成' }).click()
  await go('专辑')
  await shot('theme-green.jpg')

  // 外观面板：海蓝 + 极光
  panel = await openAppearance()
  await panel.getByRole('radio', { name: '海蓝' }).click()
  await panel.getByRole('radio', { name: '极光' }).click()
  await sleep(800)
  await shot('appearance.jpg')
  await panel.getByRole('button', { name: '完成' }).click()

  // 悬浮球：展开状态，透明背景
  await win.evaluate(() => window.fn.setPrefs({ ballMode: 'always' }))
  let ball
  for (let i = 0; i < 100 && !(ball = app.windows().find((w) => w.url().includes('ball.html'))); i++) await sleep(100)
  await ball.emulateMedia({ colorScheme: 'dark' })
  await sleep(1500)
  await ball.mouse.move(330, 54)
  await sleep(2500)
  await ball.screenshot({ path: join(OUT, 'ball.png'), omitBackground: true })
  console.log('截图 ball.png')
} finally {
  await app.close()
  mock.kill()
  rmSync(userData, { recursive: true, force: true })
}
