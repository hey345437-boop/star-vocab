import { useMemo, useState } from 'react'
import type { Root, Word } from '../types'
import { masteryOf, useStore } from '../store/useStore'

interface Props {
  roots: Root[]
  words: Word[]
  open: boolean
  onClose: () => void
}

export default function Sidebar({ roots, words, open, onClose }: Props) {
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const selectWord = useStore((s) => s.selectWord)
  const selectedWordId = useStore((s) => s.selectedWordId)
  const progress = useStore((s) => s.progress)

  const mastered = useMemo(
    () => words.filter((w) => masteryOf(progress, w.id) === 'mastered').length,
    [words, progress],
  )
  const pct = words.length ? Math.round((mastered / words.length) * 100) : 0

  const [onlyTodo, setOnlyTodo] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return words.filter((w) => {
      if (onlyTodo && masteryOf(progress, w.id) === 'mastered') return false
      return !q || w.word.toLowerCase().includes(q) || w.def_zh.includes(q)
    })
  }, [words, query, onlyTodo, progress])

  const byRoot = useMemo(() => {
    const map = new Map<string, Word[]>()
    for (const w of filtered) {
      if (!map.has(w.rootId)) map.set(w.rootId, [])
      map.get(w.rootId)!.push(w)
    }
    return map
  }, [filtered])

  return (
    <aside className={`sidebar${open ? '' : ' collapsed'}`}>
      <button className="nav-collapse" onClick={onClose} title="收起侧栏" aria-label="收起侧栏">
        <svg viewBox="0 0 24 24" aria-hidden><polyline points="15 6 9 12 15 18" /></svg>
      </button>
      <header className="side-head">
        <div className="brand">
          <span className="brand-name">Root Atlas</span>
          <span className="brand-sub">IELTS 词根星图</span>
        </div>
        <div className="prog">
          <div className="prog-line">
            <span className="prog-num">{mastered}</span>
            <span className="prog-den">/ {words.length}</span>
            <span className="prog-label">掌握</span>
            <span className="prog-pct">{pct}%</span>
          </div>
          <div className="prog-bar"><span style={{ width: `${pct}%` }} /></div>
        </div>
      </header>

      <div className="side-tools">
        <div className="search-wrap">
          <svg viewBox="0 0 24 24" className="search-ic" aria-hidden>
            <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input
            className="search"
            placeholder="搜索单词或释义"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className={`todo-toggle${onlyTodo ? ' on' : ''}`} onClick={() => setOnlyTodo((v) => !v)}>
          只看没背
        </button>
      </div>

      <div className="list">
        {roots.map((r) => {
          const ws = byRoot.get(r.id)
          if (!ws || ws.length === 0) return null
          return (
            <section key={r.id} className="root-group">
              <div className="root-head">
                <span className="root-dot" style={{ background: r.color }} />
                <span className="root-name">{r.root}</span>
                <span className="root-mean">{r.meaning_zh}</span>
              </div>
              {ws.map((w) => {
                const m = masteryOf(progress, w.id)
                const active = w.id === selectedWordId
                return (
                  <div
                    key={w.id}
                    className={`word-row${active ? ' active' : ''}`}
                    onClick={() => selectWord(w.id)}
                  >
                    <span className={`mk mk-${m}`} style={{ '--c': r.color } as any} />
                    <span className="w">{w.word}</span>
                    <span className="zh">{w.def_zh}</span>
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
    </aside>
  )
}
