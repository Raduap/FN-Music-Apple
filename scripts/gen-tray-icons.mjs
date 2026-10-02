// 生成托盘图标：每个 DPI 尺寸单独渲染（而不是从 512px 大图缩小），16px 下也清晰
// Windows 托盘在 100% / 125% / 150% / 200% / 250% / 300% 缩放下分别使用 16 / 20 / 24 / 32 / 40 / 48 px
// 运行：node scripts/gen-tray-icons.mjs（需要 Chromium，可用 PLAYWRIGHT_CHROMIUM 指定路径）
import { chromium } from 'playwright-core'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(import.meta.dirname, '..', 'build', 'tray')
const SIZES = [16, 20, 24, 32, 40, 48]

// 32×32 设计网格。尺寸越小，笔画相对越粗、圆角相对越小，保证小尺寸下的可读性
function svg(size) {
  const k = size <= 16 ? 1 : size <= 24 ? 0.9 : 0.8 // 笔画加粗系数
  const sw = 3.6 * k + (size <= 16 ? 0.4 : 0)
  const r = size <= 16 ? 7 : 7.5
  const head = 3.5 + (size <= 16 ? 0.3 : 0)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff5b70"/>
      <stop offset="1" stop-color="#e3112f"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="31" height="31" rx="${r}" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12.6 21.6V9.6l10-2v12"/>
  </g>
  <g fill="#fff">
    <circle cx="${12.6 - head + sw / 2}" cy="21.8" r="${head}"/>
    <circle cx="${22.6 - head + sw / 2}" cy="19.8" r="${head}"/>
  </g>
</svg>`
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ deviceScaleFactor: 1 })
mkdirSync(OUT, { recursive: true })
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`)
  const png = await page.locator('svg').screenshot({ omitBackground: true })
  writeFileSync(join(OUT, `tray-${size}.png`), png)
  console.log('tray-' + size + '.png')
}
await browser.close()
