// 宣传片渲染：逐帧调用 compose.html 的 renderAt(t)，截图后送入 ffmpeg 编码为 1080p30 H.264 + AAC
// 先运行 capture.mjs 录好素材。
// 运行：node scripts/promo/render.mjs              → promo-build/fn-music-promo.mp4
//       node scripts/promo/render.mjs --sheet      → 每秒一帧的预览图 promo-build/sheet.png（快速检查用）
//       node scripts/promo/render.mjs --frames=5,12 → 指定时刻的单帧 promo-build/frame-<秒>.png
import { chromium } from 'playwright-core'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const root = join(import.meta.dirname, '..', '..')
const build = join(root, 'promo-build')
const FPS = 30
const sheet = process.argv.includes('--sheet')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 素材 ----------
const clips = {}
for (const name of readdirSync(join(build, 'clips'))) {
  const meta = JSON.parse(readFileSync(join(build, 'clips', name, 'meta.json'), 'utf8'))
  clips[name] = { ...meta, base: pathToFileURL(join(build, 'clips', name)).href + '/' }
}

// 片头拼贴用的封面：从展示数据的模拟服务器导出
const coverDir = join(build, 'covers')
if (!existsSync(coverDir) || readdirSync(coverDir).length < 20) {
  mkdirSync(coverDir, { recursive: true })
  const PORT = '17802'
  const mock = spawn(process.execPath, [join(root, 'dev/mock-server.js')], { env: { ...process.env, PORT, MOCK_SHOWCASE: '1' }, stdio: 'ignore' })
  await sleep(800)
  const base = `http://127.0.0.1:${PORT}/music/api/v1`
  const login = await fetch(`${base}/user/password-login`, { method: 'POST', body: JSON.stringify({ username: 'demo', password: createHash('sha256').update('demo').digest('hex') }) }).then((r) => r.json())
  const headers = { cookie: `music-token=${login.data.userToken}` }
  for (let i = 0; i < 36; i++) {
    const id = 'album_' + i.toString(16).padStart(8, '0')
    writeFileSync(join(coverDir, `${id}.svg`), await fetch(`${base}/static/cover?coverId=${id}`, { headers }).then((r) => r.text()))
  }
  mock.kill()
}
const covers = readdirSync(coverDir).filter((f) => f.endsWith('.svg')).map((f) => pathToFileURL(join(coverDir, f)).href)
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const icon = pathToFileURL(join(root, 'build', 'icon.png')).href

// 字体：Inter（西文，接近苹果的 SF 字形）+ 思源黑体可变字重（中文），从 npm 下载一次后缓存
const fontDir = join(build, 'fonts')
const FONTS = [['@fontsource-variable/inter@5', 'inter', 'opsz.css'], ['@fontsource-variable/noto-sans-sc@5', 'noto-sans-sc', 'index.css']]
let fontCss = ''
for (const [spec, name, css] of FONTS) {
  const dir = join(fontDir, name)
  if (!existsSync(join(dir, css))) {
    mkdirSync(dir, { recursive: true })
    try {
      const tgz = execFileSync('npm', ['pack', spec, '--silent', '--pack-destination', fontDir], { encoding: 'utf8' }).trim().split('\n').pop()
      execFileSync('tar', ['xzf', join(fontDir, tgz), '-C', dir, '--strip-components=1'])
    } catch (e) {
      console.warn(`字体 ${spec} 下载失败，改用系统字体：${e.message}`)
      continue
    }
  }
  fontCss += readFileSync(join(dir, css), 'utf8').replaceAll('url(./files/', `url(${pathToFileURL(join(dir, 'files')).href}/`)
}

// ---------- 页面 ----------
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined), args: ['--allow-file-access-from-files'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.error('页面错误：', e.message))
await page.addInitScript((data) => { window.PROMO = data }, { clips, covers, icon, version: 'v' + version })
await page.goto(pathToFileURL(join(import.meta.dirname, 'compose.html')).href)
if (fontCss) await page.addStyleTag({ content: fontCss })
const duration = await page.evaluate(() => window.DURATION)

// --frames=3.2,10.5 → 把指定时刻的画面存成 promo-build/frame-<秒>.png（检查细节用）
const only = process.argv.find((a) => a.startsWith('--frames='))
if (only) {
  for (const t of only.slice(9).split(',').map(Number)) {
    await page.evaluate((t) => window.renderAt(t), t)
    await page.screenshot({ path: join(build, `frame-${t}.png`) })
  }
  await browser.close()
  process.exit(0)
}

if (sheet) {
  const shots = []
  for (let t = 0.5; t < duration; t += 1) {
    await page.evaluate((t) => window.renderAt(t), t)
    shots.push({ t, src: 'data:image/jpeg;base64,' + (await page.screenshot({ type: 'jpeg', quality: 70 })).toString('base64') })
  }
  const p2 = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  await p2.setContent(`<body style="margin:0;background:#222;color:#ccc;font:12px sans-serif;display:grid;grid-template-columns:repeat(6,1fr);gap:4px;padding:4px">${shots.map((s) => `<div>${s.t.toFixed(1)}s<img src="${s.src}" style="width:100%"></div>`).join('')}</body>`)
  await p2.screenshot({ path: join(build, 'sheet.png'), fullPage: true })
  console.log('预览图：promo-build/sheet.png')
  await browser.close()
  process.exit(0)
}

// ---------- 配乐 ----------
const music = join(build, 'music.wav')
execFileSync(process.execPath, [join(import.meta.dirname, 'music.mjs'), music], { stdio: 'inherit' })

// ---------- 逐帧渲染并编码 ----------
const out = join(build, 'fn-music-promo.mp4')
const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-i', music,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
  '-c:a', 'aac', '-b:a', '192k',
  '-shortest', '-movflags', '+faststart',
  out,
], { stdio: ['pipe', 'inherit', 'inherit'] })
const total = Math.round(duration * FPS)
const started = Date.now()
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.renderAt(t), i / FPS)
  const jpg = await page.screenshot({ type: 'jpeg', quality: 95 })
  if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r))
  if (i % 150 === 0) console.log(`渲染 ${i}/${total} 帧（${((Date.now() - started) / 1000).toFixed(0)}s）`)
}
ff.stdin.end()
await new Promise((r, j) => ff.on('close', (code) => (code === 0 ? r() : j(new Error('ffmpeg 退出码 ' + code)))))
await browser.close()
console.log('完成：promo-build/fn-music-promo.mp4')
