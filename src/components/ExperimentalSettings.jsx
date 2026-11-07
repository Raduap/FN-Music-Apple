import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store'
import * as Icon from '../icons'

const DEFAULTS = { enabled: false, sourceEnabled: true, aiFallback: true, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasKey: false, syllables: false, syllablesDebug: false, syllableSources: ['amll', 'liriqo', 'kugou', 'netease'] }
const SYLLABLE_SOURCES = [
  { id: 'amll', name: 'AMLL TTML DB', desc: '社区人工校准逐字库，质量最高' },
  { id: 'liriqo', name: 'LiriQo 聚合', desc: 'Apple / 酷狗 / 网易 / 千千等平台聚合' },
  { id: 'kugou', name: '酷狗音乐', desc: 'KRC 逐字直连，中文歌曲覆盖最好' },
  { id: 'netease', name: '网易云音乐', desc: 'YRC 逐字直连，中日英覆盖均衡' },
]
const SECTIONS = [
  { id: 'translate', label: '歌词翻译', icon: Icon.Translate },
  { id: 'syllables', label: '逐字歌词', icon: Icon.Lyrics },
]

export function ExperimentalSettings() {
  const open = useUI((s) => s.experimentalOpen)
  const close = useUI((s) => s.closeExperimental)
  const saved = useUI((s) => s.experimental)
  const ui = useUI.getState
  const ref = useRef(null)
  const lastFocus = useRef(null)
  const [tab, setTab] = useState('translate')
  const [form, setForm] = useState({ ...DEFAULTS, ...saved, apiKey: '' })
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!open) return
    setTab('translate')
    ui().loadExperimental().then((r) => {
      const s = useUI.getState()
      setForm({ ...DEFAULTS, ...r, apiKey: '', syllables: s.syllables, syllablesDebug: s.syllablesDebug })
      setStatus(null)
    })
    lastFocus.current = document.activeElement
    setTimeout(() => ref.current?.querySelector('button')?.focus(), 30)
    const onKey = (e) => { if (e.key === 'Escape' && !ui().menu) { e.stopPropagation(); close() } }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close])

  if (!open) return null

  const patch = { enabled: form.enabled, sourceEnabled: form.sourceEnabled, aiFallback: form.aiFallback, baseUrl: form.baseUrl.trim(), model: form.model.trim() }
  const save = async (extra = {}) => {
    setBusy('save')
    setStatus(null)
    const r = await ui().saveExperimental({ ...patch, ...extra, ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}) })
    setBusy('')
    if (!r?.ok) return setStatus({ bad: true, text: r?.error || '保存失败' })
    setForm((f) => ({ ...f, ...r.settings, apiKey: '' }))
    return true
  }
  const test = async () => {
    setBusy('test')
    setStatus(null)
    const r = await window.fn.experimentalTest?.({ ...patch, ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}) })
    setBusy('')
    setStatus(r?.ok ? { good: true, text: r.message || '连接正常' } : { bad: true, text: r?.error || '连接失败' })
  }
  const toggleSyllables = async () => {
    const syllables = !form.syllables
    setForm((f) => ({ ...f, syllables }))
    await ui().setSyllables(syllables)
  }
  const toggleSource = async (id) => {
    const next = form.syllableSources.includes(id)
      ? form.syllableSources.filter((s) => s !== id)
      : [...form.syllableSources, id]
    if (!next.length) return // 至少保留一个源
    setForm((f) => ({ ...f, syllableSources: next }))
    await save({ syllableSources: next })
  }
  const moveSource = async (id, dir) => {
    const list = [...form.syllableSources]
    const i = list.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    setForm((f) => ({ ...f, syllableSources: list }))
    await save({ syllableSources: list })
  }
  const toggle = async () => {
    const next = !form.enabled
    if (next && form.aiFallback && (!patch.baseUrl || !patch.model)) return setStatus({ bad: true, text: '请先填写 Base URL 和模型名，或关闭 AI 补译' })
    setForm((f) => ({ ...f, enabled: next }))
    await save({ enabled: next })
  }
  const trap = (e) => {
    if (e.key !== 'Tab') return
    const els = [...ref.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
    const first = els[0], last = els[els.length - 1]
    if (!first) return
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div className="dialog-mask ap-mask" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={ref} className="dialog ap experimental" role="dialog" aria-modal="true" aria-labelledby="exp-title" onKeyDown={trap}>
        <aside className="exp-nav">
          <div className="exp-nav-head">
            <h2 id="exp-title">实验性设置</h2>
            <p>这些功能可能随时调整</p>
          </div>
          <nav aria-label="实验性设置分区">
            {SECTIONS.map((s) => {
              const Ic = s.icon
              return (
                <button key={s.id} className={tab === s.id ? 'on' : ''} aria-current={tab === s.id ? 'page' : undefined} onClick={() => setTab(s.id)}>
                  <Ic size={16} /><span>{s.label}</span>
                </button>
              )
            })}
          </nav>
          <div className={`exp-nav-state ${form.enabled || form.syllables ? 'on' : ''}`}>
            <i aria-hidden="true" />
            <span>{[form.enabled && 'AI 补译', form.syllables && '逐字歌词'].filter(Boolean).join(' · ') || '未开启任何实验功能'}</span>
          </div>
        </aside>

        <section className="exp-main">
          <header className="exp-top">
            <span>{SECTIONS.find((s) => s.id === tab)?.label}</span>
            <button className="icon-btn" onClick={close} aria-label="关闭" title="关闭 (Esc)"><Icon.Close size={16} /></button>
          </header>
          <div className="exp-scroll">
            {tab === 'translate' && (
              <>
                <section className="exp-section">
                  <div className="exp-section-title">功能</div>
                  <div className="exp-note">
                    <Icon.Translate size={18} />
                    <div>
                      <b>翻译外语歌词</b>
                      <p>优先使用网易云源站自带的中文译文；源站没有译文的外语行，再调用你配置的 OpenAI 兼容端点补译。已有译文不会被覆盖。</p>
                    </div>
                  </div>
                  <button className={`fl-toggle exp-toggle ${form.enabled ? 'on' : ''}`} role="switch" aria-checked={form.enabled} onClick={toggle}>
                    <span>启用歌词翻译</span><span className="fl-switch" aria-hidden="true" />
                  </button>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">工作方式</div>
                  <button className={`fl-toggle exp-toggle ${form.sourceEnabled ? 'on' : ''}`} role="switch" aria-checked={form.sourceEnabled} onClick={async () => { const sourceEnabled = !form.sourceEnabled; setForm((f) => ({ ...f, sourceEnabled })); await save({ sourceEnabled }) }}>
                    <span>源站译词优先</span><span className="fl-switch" aria-hidden="true" />
                  </button>
                  <button className={`fl-toggle exp-toggle ${form.aiFallback ? 'on' : ''}`} role="switch" aria-checked={form.aiFallback} onClick={async () => { const aiFallback = !form.aiFallback; setForm((f) => ({ ...f, aiFallback })); await save({ aiFallback }) }}>
                    <span>源站缺译文时用 AI 补译</span><span className="fl-switch" aria-hidden="true" />
                  </button>
                  <ul className="exp-list">
                    <li>先展示原始歌词，命中缺译文的外语行后再异步翻译。</li>
                    <li>中文歌词、纯音乐和已有译文都不会被改写。</li>
                    <li>当前曲目的侧栏歌词、全屏播放页和悬浮歌词都会同步显示译文。</li>
                  </ul>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">OpenAI 兼容端点</div>
                  <label className="exp-field">
                    <span>Base URL</span>
                    <input className="input" value={form.baseUrl} placeholder="https://api.deepseek.com/v1" onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
                  </label>
                  <label className="exp-field">
                    <span>模型名</span>
                    <input className="input" value={form.model} placeholder="deepseek-chat" onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
                  </label>
                  <label className="exp-field">
                    <span>API Key {form.hasKey && <em>已保存；留空表示不修改</em>}</span>
                    <input className="input" type="password" value={form.apiKey} placeholder={form.hasKey ? '••••••••' : 'sk-...'} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} />
                  </label>
                  <div className="exp-actions">
                    <button className="btn" onClick={test} disabled={busy === 'test'}>{busy === 'test' ? '测试中…' : '测试连接'}</button>
                    <button className="btn btn-accent" onClick={() => save().then((ok) => ok && setStatus({ good: true, text: '设置已保存' }))} disabled={busy === 'save'}>{busy === 'save' ? '保存中…' : '保存'}</button>
                  </div>
                  {status && <div className={`exp-status ${status.good ? 'good' : 'bad'}`}>{status.text}</div>}
                  <p className="exp-hint">测试连接会使用当前输入，但不会保存；API Key 只有点“保存”后才写入本机安全存储。</p>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">隐私与边界</div>
                  <ul className="exp-list">
                    <li>API Key 通过系统安全存储加密保存在本机，不写入项目文件，也不会回显明文。</li>
                    <li>“源站译词优先”只向网易云查询匹配歌词；只有源站缺译文且打开 AI 补译时，缺失行的歌词文本才会发送到你填写的翻译端点。</li>
                    <li>此设置不会修改飞牛服务器上的原始歌词，也不会写回 NAS。</li>
                  </ul>
                </section>
              </>
            )}

            {tab === 'syllables' && (
              <>
                <section className="exp-section">
                  <div className="exp-section-title">功能</div>
                  <div className="exp-note">
                    <Icon.Lyrics size={18} />
                    <div>
                      <b>逐字 / 卡拉OK歌词</b>
                      <p>优先使用 AMLL TTML DB 的社区人工逐字歌词，其次通过聚合接口获取各平台词级时间轴；当前句按真实播放进度逐字扫色。</p>
                    </div>
                  </div>
                  <button className={`fl-toggle exp-toggle ${form.syllables ? 'on' : ''}`} role="switch" aria-checked={!!form.syllables} onClick={toggleSyllables}>
                    <span>启用逐字歌词</span><span className="fl-switch" aria-hidden="true" />
                  </button>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">工作方式</div>
                  <ul className="exp-list">
                    <li>只在当前句显示逐字扫色；没有逐字数据的歌自动退回逐行歌词，不影响显示。</li>
                  </ul>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">数据源</div>
                  <div className="exp-list">
                    {SYLLABLE_SOURCES.map((src) => {
                      const on = form.syllableSources.includes(src.id)
                      const idx = form.syllableSources.indexOf(src.id)
                      return (
                        <div key={src.id} className="exp-source-row">
                          <button className={`fl-toggle exp-toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => toggleSource(src.id)}>
                            <span>
                              <b>{idx >= 0 ? `${idx + 1}. ` : ''}{src.name}</b>
                              <small>{src.desc}</small>
                            </span>
                            <span className="fl-switch" aria-hidden="true" />
                          </button>
                          <span className="exp-source-move">
                            <button className="icon-btn" title="上移" aria-label={`上移 ${src.name}`} disabled={idx <= 0} onClick={() => moveSource(src.id, -1)}>↑</button>
                            <button className="icon-btn" title="下移" aria-label={`下移 ${src.name}`} disabled={idx < 0 || idx >= form.syllableSources.length - 1} onClick={() => moveSource(src.id, 1)}>↓</button>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <ul className="exp-list">
                    <li>开关控制是否使用该源，箭头调整尝试顺序；至少保留一个数据源。</li>
                  </ul>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">调试</div>
                  <button
                    className={`fl-toggle exp-toggle ${form.syllablesDebug ? 'on' : ''}`}
                    role="switch"
                    aria-checked={!!form.syllablesDebug}
                    onClick={async () => {
                      const syllablesDebug = !form.syllablesDebug
                      setForm((f) => ({ ...f, syllablesDebug }))
                      ui().toggleSyllablesDebug()
                    }}
                  >
                    <span>逐字调试提示</span><span className="fl-switch" aria-hidden="true" />
                  </button>
                  <ul className="exp-list">
                    <li>开启后每次切歌都会用 Toast 提示逐字数据是否命中、命中多少行、不生效的原因（无数据 / 来源错误 / 文本不匹配）。</li>
                  </ul>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">说明</div>
                  <ul className="exp-list">
                    <li>逐字歌词是实验性功能，命中率和扫色精度依赖社区数据质量。</li>
                    <li>此开关保存在本机偏好里，重启后保持。</li>
                  </ul>
                </section>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}