// 逐字歌词审计主程序（Electron 主进程，真实网络抓取 + 真实合并逻辑）。
//
// 运行：
//   npx electron dev/syllable-audit/run.mjs --library V:\ --total 100 --amll-total 25
// 参数：
//   --library <dir>   曲库目录（默认 V:\）
//   --total <n>       直连源（kugou/netease/qq）样本量（默认 100）
//   --amll-total <n>  AMLL/LiriQo 样本量（默认 25，从前 total 首里取）
//   --seed <n>        随机种子（默认 1，保证可复现）
//   --sources <a,b,c> 只测指定源（默认全部）
//   --out <file>      明细 JSON 输出路径（默认 dev/syllable-audit/out/report.json）
//   --concurrency <n> 并发数（默认 1；LiriQo 有限流，建议保持串行）
//
// 产出：控制台汇总 + 明细 JSON（含可疑清单，供人工回看）。
import { app } from 'electron'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')

const { fetchSyllables, SYLLABLE_SOURCES } = require(join(root, 'electron', 'syllables.js'))
const { loadLibrary } = require(join(here, 'library.js'))
const { stratifiedSample } = require(join(here, 'sample.js'))
const { scoreSource } = await import(pathToFileURL(join(here, 'score.mjs')).href)
const L = await import(pathToFileURL(join(root, 'electron', 'lyricsMerge.mjs')).href)

function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t.startsWith('--')) {
      const k = t.slice(2)
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
      a[k] = v
    }
  }
  return a
}

const args = parseArgs(process.argv.slice(2))
const LIB = args.library || 'V:\\'
const TOTAL = +(args.total || 100)
const AMLL_TOTAL = +(args['amll-total'] || 25)
const SEED = +(args.seed || 1)
const DIRECT_SOURCES = ['kugou', 'netease', 'qq']
const LIGHT_SOURCES = ['amll', 'liriqo']
const WANTED = (args.sources ? String(args.sources).split(',').map((s) => s.trim()) : SYLLABLE_SOURCES)
  .filter((s) => SYLLABLE_SOURCES.includes(s))

const pct = (x) => (x * 100).toFixed(1) + '%'
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

app.whenReady().then(async () => {
  if (!WANTED.length) { console.error('没有可测的源'); app.exit(1); return }
  const all = loadLibrary(LIB)
  console.log(`曲库 ${LIB}：${all.length} 首（含 LRC）`)
  const { strata, picked } = stratifiedSample(all, { seed: SEED, total: TOTAL })
  console.log('分层：', JSON.stringify(strata), `| 抽样 ${picked.length} 首`)

  // 直连源用完整样本；轻量源用前 N 首（同一批，保证口径一致）
  const directSet = picked
  const lightSet = picked.slice(0, AMLL_TOTAL)

  const jobs = []
  for (const t of directSet) for (const s of DIRECT_SOURCES) if (WANTED.includes(s)) jobs.push({ t, s })
  for (const t of lightSet) for (const s of LIGHT_SOURCES) if (WANTED.includes(s)) jobs.push({ t, s })
  console.log(`抓取任务 ${jobs.length} 个（直连 ${directSet.length} 首 × ${DIRECT_SOURCES.filter((s) => WANTED.includes(s)).length} + 轻量 ${lightSet.length} 首 × ${LIGHT_SOURCES.filter((s) => WANTED.includes(s)).length}）`)

  const byTrack = new Map()
  const getRow = (t) => { if (!byTrack.has(t.base)) byTrack.set(t.base, { title: t.title, artist: t.artist, base: t.base, sources: {} }); return byTrack.get(t.base) }
  let done = 0
  // 串行执行（LiriQo 限流 + 单源内部已节流）；如需提速可改并发
  for (const job of jobs) {
    const row = getRow(job.t)
    const sources = [job.s]
    const localLines = L.toLines(job.t.lrcText)
    try {
      // 审计没有解码音频，用本地 LRC 的末行时间 + 3s 近似歌曲时长，
      // 与生产传入 song.duration 的效果一致（用于区分同名不同版本）。
      const approxDuration = (() => {
        const ts = localLines.map((l) => Number(l?.time)).filter(Number.isFinite)
        return ts.length ? Math.max(...ts) + 3 : 0
      })()
      const r = await fetchSyllables({ title: job.t.title, artist: job.t.artist, duration: approxDuration, sources, debug: true })
      const s = scoreSource(localLines, r.candidates || [])
      const slim = { ...s, perCand: s.perCand.map((c) => { const { merged: _m, ...rest } = c; return rest }) }
      slim.picked = s.picked ? { ...s.perCand[s.pickedIdx], merged: undefined } : null
      slim.debug = r.debug
      row.sources[job.s] = slim
    } catch (e) {
      row.sources[job.s] = { error: e.message }
    }
    done++
    if (done % 10 === 0 || done === jobs.length) console.log(`  进度 ${done}/${jobs.length}`)
  }

  // ---- 汇总 ----
  const rows = [...byTrack.values()]
  const summary = { lib: LIB, seed: SEED, strata, directN: directSet.length, lightN: lightSet.length, perSource: {} }
  for (const src of WANTED) {
    const rs = rows.filter((r) => r.sources[src] && !r.sources[src].error)
    const supported = rs.filter((r) => r.sources[src].perCand.length > 0)
    const hit = rs.filter((r) => r.sources[src].picked && r.sources[src].picked.coverage > 0)
    summary.perSource[src] = {
      sampled: rs.length,
      withCandidates: supported.length,
      withPickedCoverage: hit.length,
      hitRate: rs.length ? hit.length / rs.length : 0,
      avgCoverageOnHit: avg(hit.map((r) => r.sources[src].picked.coverage)),
      avgTextAgreeOnHit: avg(hit.map((r) => r.sources[src].picked.textAgreeRate)),
      suspicious: [],
    }
  }
  // 可疑清单：命中但文本吻合率低（可能配错）/ 覆盖率中等偏低
  for (const r of rows) {
    for (const src of WANTED) {
      const s = r.sources[src]
      if (!s || s.error || !s.picked) continue
      const p = s.picked
      if (p.coverage > 0 && (p.textAgreeRate < 0.6 || p.coverage < 0.5 || p.outOfRange > 0 || p.nonMonotonic > 0)) {
        summary.perSource[src].suspicious.push({
          title: r.title, artist: r.artist,
          coverage: +p.coverage.toFixed(3), textAgree: +p.textAgreeRate.toFixed(3),
          track: p.track, artist2: p.artist,
          outOfRange: p.outOfRange, nonMonotonic: p.nonMonotonic, zeroSpan: p.zeroSpan,
        })
      }
    }
  }

  // ---- 输出 ----
  const outPath = args.out ? resolve(args.out) : join(here, 'out', 'report.json')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 1), 'utf8')

  console.log('\n===== 汇总 =====')
  for (const src of WANTED) {
    const s = summary.perSource[src]
    console.log(`${src.padEnd(8)} 命中 ${String(s.withPickedCoverage).padStart(3)}/${String(s.sampled).padStart(3)} (${pct(s.hitRate)})` +
      ` | 有候选 ${s.withCandidates} | 平均覆盖 ${pct(s.avgCoverageOnHit)} | 文本吻合 ${pct(s.avgTextAgreeOnHit)} | 可疑 ${s.suspicious.length}`)
  }
  console.log(`\n明细已写入 ${outPath}`)
  app.exit(0)
})
