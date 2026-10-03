// 宣传片时间轴：renderAt(t) 把画面设置为第 t 秒的样子（纯函数式，逐帧渲染时调用）
// 素材由 render.mjs 注入 window.PROMO = { clips: { 名称: meta + base }, covers: [文件地址], icon, version }
// 风格参照苹果发布会：纯黑底、大号粗体标题由模糊中浮现、产品放在笔记本电脑里、镜头推入屏幕
/* global PROMO */
const $ = (id) => document.getElementById(id)
const BAR = 60 / 96 * 4 // 配乐 96 BPM，一小节 2.5 秒；场景切换都落在小节线上（与 music.mjs 一致）
const T = {
  open: [0, 2 * BAR],
  title: [2 * BAR, 4 * BAR],
  library: [4 * BAR, 7 * BAR],
  play: [7 * BAR, 11 * BAR],
  themes: [11 * BAR, 15 * BAR],
  ball: [15 * BAR, 18 * BAR],
  features: [18 * BAR, 21 * BAR],
  outro: [21 * BAR, 24 * BAR],
}
window.DURATION = 24 * BAR

// ---------- 缓动 ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const lerp = (a, b, k) => a + (b - a) * k
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3)
const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(x)))
const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
const prog = (t, a, d) => clamp((t - a) / d)
// 场景可见度：起止两端各有 fade 秒的交叉淡化
const vis = (t, [a, b], fade = 0.6) => Math.min(clamp((t - a + fade / 2) / fade), clamp((b + fade / 2 - t) / fade))

// 关键帧插值：[[时间, 值...], ...]
function keys(list, t) {
  if (t <= list[0][0]) return list[0].slice(1)
  for (let i = 1; i < list.length; i++) {
    if (t <= list[i][0]) {
      const k = easeInOut((t - list[i - 1][0]) / (list[i][0] - list[i - 1][0]))
      return list[i].slice(1).map((v, j) => lerp(list[i - 1][j + 1], v, k))
    }
  }
  return list[list.length - 1].slice(1)
}

// 颜色插值（#rrggbb）
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, k) => `rgb(${rgb(a).map((v, i) => Math.round(lerp(v, rgb(b)[i], k))).join(',')})`

// 苹果式的文字出现：从模糊中浮现并轻轻上移，离场时再次虚化
function reveal(el, t, a, b, { blur = 18, rise = 28, dur = 0.9, out = 0.5, scale = 0 } = {}) {
  const i = easeOutExpo(prog(t, a, dur))
  const o = b == null ? 0 : easeInOut(prog(t, b - out, out))
  const v = i * (1 - o)
  el.style.opacity = v
  const bl = (1 - i) * blur + o * blur * 0.6
  el.style.filter = bl > 0.05 ? `blur(${bl.toFixed(2)}px)` : 'none'
  el.style.transform = `translateY(${((1 - i) * rise - o * rise * 0.5).toFixed(2)}px) scale(${1 + (1 - i) * scale})`
  return v
}

// ---------- 素材：按片段时间取帧、取光标位置 ----------
function clipAt(name, ct) {
  const c = PROMO.clips[name]
  const ts = c.timeScale || 1
  const time = (x) => (x - c.t0) * ts
  let lo = 0, hi = c.frames.length - 1, ans = 0
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (time(c.frames[mid].t) <= ct) { ans = mid; lo = mid + 1 } else hi = mid - 1 }
  const frame = c.base + c.frames[ans].file
  // 光标：线性插值
  const cur = c.cursor
  let i = cur.findIndex((p) => time(p.t) > ct)
  if (i === -1) i = cur.length
  const p0 = cur[Math.max(0, i - 1)], p1 = cur[Math.min(cur.length - 1, i)]
  const span = time(p1.t) - time(p0.t)
  const k = span > 0 ? clamp((ct - time(p0.t)) / span) : 0
  const cursor = { x: lerp(p0.x, p1.x, k), y: lerp(p0.y, p1.y, k) }
  const click = c.clicks.map((q) => ({ ...q, age: ct - time(q.t) })).filter((q) => q.age >= 0 && q.age < 0.5).pop()
  return { frame, cursor, click }
}

const decodes = []
function setSrc(img, src) {
  if (img.getAttribute('src') === src) return
  img.setAttribute('src', src)
  decodes.push(img.decode().catch(() => {}))
}
const style = (el, o, tf) => { el.style.opacity = o; if (tf !== undefined) el.style.transform = tf }
function ripple(el, click, k = 1) {
  if (!click) { el.style.opacity = 0; return }
  const a = click.age / 0.5
  el.style.left = click.x * k + 'px'
  el.style.top = click.y * k + 'px'
  return a
}

// ---------- 开场：两句话 + 缓缓浮现的封面墙 ----------
function setupOpen() {
  const covers = PROMO.covers
  $('wall').innerHTML = Array.from({ length: 70 }, (_, i) => `<img src="${covers[(i * 7) % covers.length]}">`).join('')
  for (const id of ['titleIcon', 'outroIcon', 'taskIcon']) $(id).src = PROMO.icon
}
function renderOpen(t) {
  const o = t < T.title[1] + 0.5 ? 1 : 0
  style($('open'), o)
  if (!o) return
  reveal($('line1'), t, 0.3, 2.3)
  reveal($('line2'), t, 2.55, 4.85)
  // 封面墙：第二句话时浮现，片名期间压暗，片名结束前淡出
  const w = 0.5 * easeOut(prog(t, 2.4, 2.2)) * (1 - 0.45 * easeInOut(prog(t, 4.6, 0.8))) * (1 - easeInOut(prog(t, 9.0, 0.9)))
  $('wall').style.opacity = w
  $('wall').style.transform = `rotate(-8deg) translate(${(-t * 24).toFixed(2)}px, ${(-t * 9).toFixed(2)}px)`
}

// ---------- 片名 ----------
function renderTitle(t) {
  const o = vis(t, T.title, 0.4)
  style($('title'), o ? 1 : 0)
  if (!o) return
  const end = T.title[1] + 0.1
  reveal($('titleIcon'), t, T.title[0] + 0.05, end, { blur: 24, rise: 0, dur: 1.1, scale: 0.35 })
  reveal($('titleBrand'), t, T.title[0] + 0.45, end, { blur: 26, rise: 36, dur: 1.2 })
  reveal($('titleLede'), t, T.title[0] + 1.2, end, { blur: 14, rise: 20 })
  $('title').querySelector('.center').style.transform = `scale(${1 + 0.035 * prog(t, T.title[0], BAR * 2)})`
}

// ---------- 产品场景（笔记本屏幕里的四个片段） ----------
const SW = 1180, SH = 737.5 // 屏幕尺寸
const K = SW / 1280 // 应用窗口 CSS 像素 → 屏幕像素
const SEGMENTS = [
  { clip: 'library', from: 0.2, to: 8.0, at: T.library, zoom: [[0, 1, 640, 400]] },
  { clip: 'album', from: 0.5, to: 3.4, at: [T.play[0], T.play[0] + 2.9], zoom: [[0, 1.1, 560, 420]] },
  { clip: 'player', from: 0.3, to: 0.3 + (T.play[1] - T.play[0] - 2.9), at: [T.play[0] + 2.9, T.play[1]], zoom: [[0, 1.1, 560, 420], [1.0, 1, 640, 400]] },
  { clip: 'themes', from: 0.8, to: 14.2, at: T.themes,
    zoom: [[0, 1, 640, 400], [3.2, 1, 640, 400], [4.6, 1.32, 640, 400], [11.0, 1.32, 640, 410], [12.4, 1, 640, 400], [14.2, 1, 640, 400]] },
]
const GRADS = {
  red: 'linear-gradient(100deg, #ff7a8a, #fa2d48 55%, #ff9a5a)',
  warm: 'linear-gradient(100deg, #fbbf24, #fb7185 60%, #e879f9)',
  cool: 'linear-gradient(100deg, #34d399, #22d3ee 50%, #60a5fa)',
}
const CAPS = [
  { at: [T.library[0] + 0.5, T.library[1] - 0.15], h: '整个音乐库，<em>焕然一新。</em>', p: '专辑、艺人与歌单，一目了然。', grad: GRADS.red },
  { at: [T.play[0] + 0.25, T.play[0] + 4.3], h: '<em>沉浸</em>，从封面开始。', p: '封面取色背景 · 逐行同步歌词 · 无损音质标识', grad: GRADS.warm },
  { at: [T.themes[0] + 0.25, T.themes[1] - 0.25], h: '你的颜色，<em>你来定。</em>', p: '经典红 · 墨绿 · 海蓝 · 浅色与深色 · 自定义壁纸', grad: GRADS.cool },
]
// 推入屏幕：播放页打开后，镜头推进直到屏幕铺满画面，看一会儿歌词再拉回
// 录屏在页面切换动画期间不出帧，播放页是“跳”出来的：让跳变发生在屏幕已经铺满时，再用一次闪切盖住
const DIVE = { in: [T.play[0] + 4.6, 1.2], out: [T.play[1] - 1.4, 1.3] }
const CUTS = [{ clip: 'player', ct: 3.45 }]
const DIVE_SCALE = 1920 / SW

function setupScene() {
  $('caps').innerHTML = CAPS.map((c) => `<div class="cap" style="--grad:${c.grad}"><h2>${c.h}</h2><p>${c.p}</p></div>`).join('')
}

function renderScene(t) {
  const o = vis(t, [T.library[0], T.themes[1]], 0.6)
  style($('scene'), o ? 1 : 0)
  if (!o) return

  // 机身：从下方抬起并放平；离场时略微后退并淡出
  const rise = easeOutExpo(prog(t, T.library[0] - 0.1, 1.8))
  const leave = easeInOut(prog(t, T.themes[1] - 0.45, 0.6))
  const dive = easeInOut(prog(t, ...DIVE.in)) * (1 - easeInOut(prog(t, ...DIVE.out)))
  const s = lerp(1, DIVE_SCALE, dive) * (1 - 0.05 * leave)
  $('rig').style.transform = `translateY(${((1 - rise) * 560).toFixed(2)}px) rotateX(${((1 - rise) * 38).toFixed(2)}deg) translateY(${(-118.75 * dive).toFixed(2)}px) scale(${s.toFixed(4)})`
  $('rig').style.opacity = clamp(rise * 1.6) * (1 - leave)

  // 标题
  ;[...$('caps').children].forEach((el, i) => {
    const c = CAPS[i]
    if (t < c.at[0] - 0.1 || t > c.at[1] + 0.1) { el.style.opacity = 0; return }
    reveal(el.querySelector('h2'), t, c.at[0], c.at[1])
    reveal(el.querySelector('p'), t, c.at[0] + 0.3, c.at[1], { blur: 12, rise: 18 })
    el.style.opacity = 1
  })

  // 屏幕内容
  const seg = SEGMENTS.find((x) => t < x.at[1]) || SEGMENTS[SEGMENTS.length - 1]
  const local = t - seg.at[0]
  const speed = (seg.to - seg.from) / (seg.at[1] - seg.at[0])
  const ct = clamp(seg.from + local * speed, seg.from, seg.to)
  const { frame, cursor, click } = clipAt(seg.clip, ct)
  setSrc($('frame'), frame)

  // 屏幕里的镜头推拉：关键帧给出缩放倍数与对准的点（应用窗口 CSS 像素）
  const [z, fx, fy] = keys(seg.zoom, ct)
  const tx = clamp(SW / 2 - fx * K * z, SW - SW * z, 0)
  const ty = clamp(SH / 2 - fy * K * z, SH - SH * z, 0)
  $('content').style.transform = `translate(${tx}px, ${ty}px) scale(${z})`

  // 光标与点击（在内容层里，跟着推拉一起缩放）
  $('cursor').style.transform = `translate(${cursor.x * K - 5}px, ${cursor.y * K - 3}px) scale(${1 / z})`
  $('cursor').style.transformOrigin = '5px 3px'
  const a = ripple($('ripple'), click, K)
  if (a !== undefined) style($('ripple'), 1 - a, `scale(${(0.5 + easeOut(a) * 0.7) / z})`)

  // 片段之间：画面短暂压暗，掩盖跳切（首个片段开头不压暗）
  let edge = Math.min(seg === SEGMENTS[0] ? 9 : local, seg.at[1] - t)
  for (const c of CUTS) if (c.clip === seg.clip) edge = Math.min(edge, Math.abs(ct - c.ct) / speed)
  const dip = clamp(edge / 0.2)
  $('frame').style.filter = dip < 1 ? `brightness(${0.5 + 0.5 * dip}) blur(${((1 - dip) * 6).toFixed(2)}px)` : 'none'

  // 机身下方的彩色柔光：跟随场景变色，推入屏幕时收起
  const color = t < T.play[0] ? mix('#fa233b', '#ff6b3d', prog(t, T.play[0] - 0.6, 0.6))
    : t < T.themes[0] ? mix('#ff6b3d', '#12a27a', prog(t, T.themes[0] - 0.6, 0.6))
      : mix('#12a27a', '#2f7cf6', prog(t, T.themes[0] + 4, 2))
  $('glow').style.background = color
  $('glow').style.opacity = 0.42 * rise * (1 - dive) * (1 - leave)
}

// ---------- 悬浮球 ----------
function renderBall(t) {
  const o = vis(t, T.ball)
  style($('desktop'), o)
  if (!o) return
  const local = t - T.ball[0]
  const span = T.ball[1] - T.ball[0]
  const ct = 0.7 + local * ((9.4 - 0.7) / span)
  const { frame, cursor, click } = clipAt('ball', ct)
  setSrc($('ballFrame'), frame)
  const S = 2.5 // 384×108 的悬浮球窗口放大 2.5 倍
  $('ballCursor').style.transform = `translate(${cursor.x * S - 5}px, ${cursor.y * S - 3}px)`
  const a = ripple($('ballRipple'), click, S)
  if (a !== undefined) style($('ballRipple'), 1 - a, `scale(${0.5 + easeOut(a) * 0.7})`)
  const cap = $('ballCap')
  reveal(cap.querySelector('h2'), t, T.ball[0] + 0.35, T.ball[1] + 1)
  reveal(cap.querySelector('p'), t, T.ball[0] + 0.7, T.ball[1] + 1, { blur: 12, rise: 18 })
  cap.style.opacity = 1
  $('ballWrap').style.transform = `translateY(${(Math.sin(local * 1.2) * 4).toFixed(2)}px)`
}

// ---------- 更多细节：便当盒式网格 ----------
const ICONS = {
  disk: '<path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z"/><path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  resume: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  tray: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="17" cy="13" r="1.2"/>',
  keys: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10"/>',
}
const TILES = [
  { ic: 'disk', color: '#38bdf8', wide: true, grad: 'linear-gradient(100deg, #38bdf8, #818cf8)', b: '封面，<em>瞬间显示。</em>', s: '看过的封面保存在本地磁盘，再次打开无需等待；最多占用 400 MB，旧的自动清理。' },
  { ic: 'tray', color: '#34d399', b: '关窗不停播', s: '最小化到托盘，随时唤回。' },
  { ic: 'keys', color: '#c084fc', b: '媒体键直控', s: '键盘媒体键与 Windows 媒体浮窗都能控制。' },
  { ic: 'resume', color: '#fb923c', b: '接着听', s: '重启后从上次的位置继续。' },
  { ic: 'wave', color: '#facc15', wide: true, grad: 'linear-gradient(100deg, #facc15, #fb7185)', b: '<em>Hi-Res</em>，一眼可辨。', s: '无损与高解析度无损音源，在播放栏直接标注位深与采样率。' },
  { ic: 'lock', color: '#f87171', b: '凭据加密', s: '经系统加密，只存在本机。' },
]
function setupFeatures() {
  $('bento').innerHTML = TILES.map((x) => `<div class="tile${x.wide ? ' wide' : ''}" style="--grad:${x.grad || 'none'}"><svg viewBox="0 0 24 24" fill="none" stroke="${x.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[x.ic]}</svg><b>${x.b}</b><span>${x.s}</span></div>`).join('')
}
function renderFeatures(t) {
  const o = vis(t, T.features)
  style($('features'), o)
  if (!o) return
  const local = t - T.features[0]
  const cap = $('featCap')
  reveal(cap.querySelector('h2'), t, T.features[0] + 0.25, T.features[1] + 1)
  cap.style.opacity = 1
  $('bento').style.transform = `scale(${1 + 0.025 * prog(local, 0, BAR * 3)})`
  ;[...$('bento').children].forEach((el, i) => {
    const k = easeOutExpo(prog(local, 0.75 + i * 0.1, 1.1))
    el.style.opacity = clamp(k * 1.4)
    el.style.transform = `translateY(${((1 - k) * 70).toFixed(2)}px) scale(${0.95 + 0.05 * k})`
    el.style.filter = k < 0.99 ? `blur(${((1 - k) * 10).toFixed(2)}px)` : 'none'
  })
}

// ---------- 片尾 ----------
function renderOutro(t) {
  const o = vis(t, T.outro, 0.4) * (1 - easeInOut(prog(t, window.DURATION - 0.9, 0.9)))
  style($('outro'), o)
  if (!o) return
  const a = T.outro[0]
  reveal($('outroIcon'), t, a + 0.15, null, { blur: 20, rise: 0, dur: 1.0, scale: 0.3 })
  reveal($('outroBrand'), t, a + 0.5, null, { blur: 22, rise: 30 })
  reveal($('outroLede'), t, a + 0.95, null, { blur: 12, rise: 18 })
  reveal($('outroChips'), t, a + 1.4, null, { blur: 10, rise: 16 })
  reveal($('outroUrl'), t, a + 1.75, null, { blur: 10, rise: 14 })
  reveal($('legal'), t, a + 2.2, null, { blur: 6, rise: 0, dur: 1.2 })
}

// 预加载所有用到的字形（中文字体按字符分片，按需下载）
async function loadFonts() {
  const text = document.body.textContent + CAPS.map((c) => c.h + c.p).join('') + TILES.map((x) => x.b + x.s).join('') + PROMO.version
  const plain = text.replace(/<[^>]+>/g, '')
  await Promise.all([400, 500, 600, 700, 800].flatMap((w) => [
    document.fonts.load(`${w} 40px "Noto Sans SC Variable"`, plain),
    document.fonts.load(`${w} 40px "Inter Variable"`, plain),
  ]))
  await document.fonts.ready
}

let ready = false
window.renderAt = async function renderAt(t) {
  if (!ready) {
    setupOpen()
    setupScene()
    setupFeatures()
    $('ver').textContent = PROMO.version
    await loadFonts().catch(() => {})
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})))
    ready = true
  }
  decodes.length = 0
  if (!(t >= T.library[0] - 0.5 && t <= T.themes[1] + 0.5)) $('glow').style.opacity = 0
  renderOpen(t)
  renderTitle(t)
  renderScene(t)
  renderBall(t)
  renderFeatures(t)
  renderOutro(t)
  await Promise.all(decodes)
}
