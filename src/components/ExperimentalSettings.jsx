import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store'
import { moveItem } from '../lib'
import * as Icon from '../icons'

const DEFAULTS = { enabled: false, sourceEnabled: true, aiFallback: true, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasKey: false, syllables: false, syllablePredict: false, syllablesDebug: false, syllableStrict: false, syllableSmooth: 'normal', syllableSources: ['amll', 'liriqo', 'kugou', 'netease', 'qq'] }
// 逐字数据源元数据（id / 名称 / 说明）。列表渲染顺序即抓取顺序，
// 用户可在设置里拖动调整；启用与否是另一维（开关），与顺序无关。
const SYLLABLE_SOURCES = [
  { id: 'amll', name: 'AMLL TTML DB', desc: '社区人工校准逐字库，质量最高' },
  { id: 'liriqo', name: 'LiriQo 聚合', desc: 'Apple / 酷狗 / 网易 / 千千等平台聚合' },
  { id: 'kugou', name: '酷狗音乐', desc: 'KRC 逐字直连，中文歌曲覆盖最好' },
  { id: 'netease', name: '网易云音乐', desc: 'YRC 逐字直连，中日英覆盖均衡' },
  { id: 'qq', name: 'QQ 音乐', desc: 'QRC 逐字直连，中文流行覆盖好' },
]
const SOURCE_BY_ID = Object.fromEntries(SYLLABLE_SOURCES.map((s) => [s.id, s]))
const SMOOTH_MODES = [
  { id: 'mild', name: '宽松', desc: '只压缩最明显的过快字，最贴近源时间戳' },
  { id: 'normal', name: '适中', desc: '推荐，把异常快的字收到常见语速' },
  { id: 'strong', name: '更稳', desc: '过快字压得更多，长音仍然保持缓慢' },
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
  // 数据源拖动状态：dragId 正在拖的源，overId 当前悬停落点，overAfter 表示落在其下方
  const [dragId, setDragId] = useState('')
  const [overId, setOverId] = useState('')
  const [overAfter, setOverAfter] = useState(false)

  useEffect(() => {
    if (!open) return
    setTab('translate')
    ui().loadExperimental().then((r) => {
      const s = useUI.getState()
      setForm({ ...DEFAULTS, ...r, apiKey: '', syllables: s.syllables, syllablePredict: s.syllablePredict, syllablesDebug: s.syllablesDebug, syllableStrict: s.syllableStrict, syllableSmooth: s.syllableSmooth })
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
  const toggleSyllablePredict = async () => {
    const syllablePredict = !form.syllablePredict
    setForm((f) => ({ ...f, syllablePredict }))
    await ui().setSyllablePredict(syllablePredict)
  }
  const toggleStrict = async () => {
    const syllableStrict = !form.syllableStrict
    setForm((f) => ({ ...f, syllableStrict }))
    await ui().setSyllableStrict(syllableStrict)
  }
  const pickSmooth = async (mode) => {
    setForm((f) => ({ ...f, syllableSmooth: mode }))
    await ui().setSyllableSmooth(mode)
  }
  const toggleSource = async (id) => {
    const next = form.syllableSources.includes(id)
      ? form.syllableSources.filter((s) => s !== id)
      : [...form.syllableSources, id]
    if (!next.length) return // 至少保留一个源
    setForm((f) => ({ ...f, syllableSources: next }))
    await save({ syllableSources: next })
  }
  // 拖动 / 键盘重排数据源：把 id 从 from 移到 to，立即持久化。
  const reorderSource = async (from, to) => {
    const list = moveItem(form.syllableSources, from, to)
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
            <span>{[form.enabled && 'AI 补译', form.syllables && '逐字歌词', form.syllablePredict && '智能逐字补全'].filter(Boolean).join(' · ') || '未开启任何实验功能'}</span>
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
                  <div className="exp-feature-row">
                    <button className={`fl-toggle exp-toggle ${form.syllables ? "on" : ""}`} role="switch" aria-checked={!!form.syllables} onClick={toggleSyllables}>
                      <span>启用逐字歌词</span><span className="fl-switch" aria-hidden="true" />
                    </button>
                    <button
                      className={`fl-toggle exp-toggle ${form.syllablePredict ? "on" : ""}`}
                      role="switch"
                      aria-checked={!!form.syllablePredict}
                      disabled={!form.syllables}
                      onClick={toggleSyllablePredict}
                    >
                      <span>智能逐字补全</span><span className="fl-switch" aria-hidden="true" />
                    </button>
                  </div>
                  <p className="exp-hint">没有词级数据的行按字词长度与标点停顿估算逐字时间，让整首歌都有扫色动画。关闭「启用逐字歌词」时本项不可用。</p>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">扫色手感</div>
                  <button
                    className={`fl-toggle exp-toggle ${form.syllableStrict ? 'on' : ''}`}
                    role="switch"
                    aria-checked={!!form.syllableStrict}
                    disabled={!form.syllables}
                    onClick={toggleStrict}
                  >
                    <span>严格匹配</span><span className="fl-switch" aria-hidden="true" />
                  </button>
                  <div className="exp-seg" role="radiogroup" aria-label="扫色速度挡位">
                    {SMOOTH_MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="radio"
                        aria-checked={form.syllableSmooth === m.id}
                        className={`exp-seg-btn ${form.syllableSmooth === m.id && !form.syllableStrict ? 'on' : ''}`}
                        disabled={!form.syllables || form.syllableStrict}
                        title={m.desc}
                        onClick={() => pickSmooth(m.id)}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                  <p className="exp-hint">
                    关闭「严格匹配」时只把过快的字（外语语气词、日语半拍假名等）收到常见语速，拖长音与慢字保持原速；开启后完全照抄源时间戳，最精确但快字更跳。
                  </p>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">工作方式</div>
                  <ul className="exp-list">
                    <li>真实词级数据优先：有逐字数据的行按原时间轴扫色，缺数据的行保持整句显示。</li>
                    <li>按下面的顺序逐个来源尝试：某来源覆盖率达到 90% 先把结果交给界面显示，达到 98% 就不再尝试后面的来源；期间出现更好的结果会静默替换，不会打断播放。</li>
                    <li>逐字结果按质量分级缓存：98% 以上永久缓存，90–98% 缓存 7 天，70–90% 缓存 24 小时，更低的只在本次运行内存里保留 30 分钟。</li>
                    <li>开启「智能逐字补全」后，缺数据的行会按字词长度和标点停顿估算逐字时间，整首歌都有扫色动画；这只是预测，节奏可能与真实演唱有偏差。</li>
                    <li>只在当前句显示逐字扫色，不会影响歌词文本本身。</li>
                  </ul>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">数据源</div>
                  <p className="exp-paragraph exp-source-hint">从上到下即抓取顺序：先命中合格线就先用，命中优秀线就停止；拖动左侧手柄可调整顺序。</p>
                  <ol className="exp-source-list">
                    {form.syllableSources.map((id, i) => {
                      const src = SOURCE_BY_ID[id]
                      if (!src) return null
                      const dragging = dragId === id
                      const over = overId === id && !!dragId && dragId !== id
                      const cls = `exp-source-item${dragging ? " dragging" : ""}${over ? (overAfter ? " over-after" : " over-before") : ""}`
                      return (
                        <li
                          key={id}
                          className={cls}
                          draggable
                          onDragStart={(e) => {
                            setDragId(id)
                            e.dataTransfer.effectAllowed = "move"
                            e.dataTransfer.setData("text/plain", id)
                          }}
                          onDragOver={(e) => {
                            if (!dragId || dragId === id) return
                            e.preventDefault()
                            e.dataTransfer.dropEffect = "move"
                            const r = e.currentTarget.getBoundingClientRect()
                            const after = e.clientY - r.top > r.height / 2
                            if (overId !== id || overAfter !== after) { setOverId(id); setOverAfter(after) }
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            const from = form.syllableSources.indexOf(dragId)
                            let to = form.syllableSources.indexOf(id)
                            setDragId("")
                            setOverId("")
                            if (from < 0 || to < 0 || from === to) return
                            if (overAfter) to += 1
                            if (from < to) to -= 1
                            if (to !== from) reorderSource(from, to)
                          }}
                          onDragEnd={() => { setDragId(""); setOverId("") }}
                        >
                          <span
                            className="exp-drag-handle"
                            role="button"
                            tabIndex={0}
                            aria-label={`拖动排序 ${src.name}，当前第 ${i + 1} 位`}
                            title="拖动调整顺序，或聚焦后用上下方向键"
                            onKeyDown={(e) => {
                              if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); reorderSource(i, i - 1) }
                              else if (e.key === "ArrowDown" && i < form.syllableSources.length - 1) { e.preventDefault(); reorderSource(i, i + 1) }
                            }}
                          >
                            <Icon.ListIcon size={16} />
                          </span>
                          <span className="exp-source-index" aria-hidden="true">{i + 1}</span>
                          <span className="exp-source-info">
                            <b>{src.name}</b>
                            <small>{src.desc}</small>
                          </span>
                          <button
                            className={`fl-switch exp-source-switch${form.syllableSources.length <= 1 ? " locked" : ""}`}
                            role="switch"
                            aria-checked="true"
                            aria-label={`关闭 ${src.name}`}
                            title={form.syllableSources.length <= 1 ? "至少保留一个数据源" : `关闭 ${src.name}`}
                            disabled={form.syllableSources.length <= 1}
                            onClick={() => toggleSource(id)}
                          />
                        </li>
                      )
                    })}
                  </ol>
                  <ul className="exp-list">
                    <li>列表顺序就是尝试顺序；开关控制是否启用，至少保留一个数据源。关闭的源会移到下方「未启用」区。</li>
                  </ul>
                  {SYLLABLE_SOURCES.some((x) => !form.syllableSources.includes(x.id)) && (
                    <div className="exp-source-disabled">
                      <div className="exp-source-disabled-title">未启用</div>
                      {SYLLABLE_SOURCES.filter((x) => !form.syllableSources.includes(x.id)).map((x) => (
                        <button key={x.id} className="exp-source-add" onClick={() => toggleSource(x.id)}>
                          <Icon.Plus size={14} /><span>{x.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
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