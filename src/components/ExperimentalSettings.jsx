import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store'
import * as Icon from '../icons'

const DEFAULTS = { enabled: false, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasKey: false }
const SECTIONS = [
  { id: 'overview', label: '翻译总览', icon: Icon.Translate },
  { id: 'endpoint', label: '翻译端点', icon: Icon.Wave },
  { id: 'notes', label: '安全说明', icon: Icon.Monitor },
]

export function ExperimentalSettings() {
  const open = useUI((s) => s.experimentalOpen)
  const close = useUI((s) => s.closeExperimental)
  const saved = useUI((s) => s.experimental)
  const ui = useUI.getState
  const ref = useRef(null)
  const lastFocus = useRef(null)
  const [tab, setTab] = useState('overview')
  const [form, setForm] = useState({ ...DEFAULTS, ...saved, apiKey: '' })
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!open) return
    setTab('overview')
    ui().loadExperimental().then((r) => {
      setForm({ ...DEFAULTS, ...r, apiKey: '' })
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

  const patch = { enabled: form.enabled, baseUrl: form.baseUrl.trim(), model: form.model.trim() }
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
  const toggle = async () => {
    const next = !form.enabled
    if (next && (!patch.baseUrl || !patch.model)) return setStatus({ bad: true, text: '请先填写 Base URL 和模型名' })
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
          <div className={`exp-nav-state ${form.enabled ? 'on' : ''}`}>
            <i aria-hidden="true" />
            <span>{form.enabled ? 'AI 补译已开启' : 'AI 补译未开启'}</span>
          </div>
        </aside>

        <section className="exp-main">
          <header className="exp-top">
            <span>{SECTIONS.find((s) => s.id === tab)?.label}</span>
            <button className="icon-btn" onClick={close} aria-label="关闭" title="关闭 (Esc)"><Icon.Close size={16} /></button>
          </header>
          <div className="exp-scroll">
            {tab === 'overview' && (
              <>
                <section className="exp-section">
                  <div className="exp-section-title">功能</div>
                  <div className="exp-note">
                    <Icon.Translate size={18} />
                    <div>
                      <b>AI 补译外语歌词</b>
                      <p>开启后，只对非中文、且还没有译文的外语歌词调用你配置的 OpenAI 兼容端点；已有译文不会被覆盖。歌词文本会发送给该端点。</p>
                    </div>
                  </div>
                  <button className={`fl-toggle exp-toggle ${form.enabled ? 'on' : ''}`} role="switch" aria-checked={form.enabled} onClick={toggle}>
                    <span>启用 AI 补译</span><span className="fl-switch" aria-hidden="true" />
                  </button>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">工作方式</div>
                  <ul className="exp-list">
                    <li>先展示原始歌词，命中缺译文的外语行后再异步补译。</li>
                    <li>中文歌词、纯音乐和已有译文都不会被改写。</li>
                    <li>当前曲目的侧栏歌词、全屏播放页和悬浮歌词都会同步显示补译结果。</li>
                  </ul>
                </section>
              </>
            )}

            {tab === 'endpoint' && (
              <>
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
              </>
            )}

            {tab === 'notes' && (
              <>
                <section className="exp-section">
                  <div className="exp-section-title">隐私与边界</div>
                  <ul className="exp-list">
                    <li>API Key 通过系统安全存储加密保存在本机，不写入项目文件，也不会回显明文。</li>
                    <li>只有开启“AI 补译”后，歌词文本才会发送到你填写的翻译端点。</li>
                    <li>此设置不会修改飞牛服务器上的原始歌词，也不会写回 NAS。</li>
                  </ul>
                </section>
                <section className="exp-section">
                  <div className="exp-section-title">适合使用</div>
                  <p className="exp-paragraph">当一首外语歌只有原文、没有官方译文时，开启它即可补充中文译文。源站已有译文时仍以原译文为准。</p>
                </section>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
