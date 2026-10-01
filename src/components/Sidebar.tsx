import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Root, Word } from '../types'
import { masteryOf, useStore } from '../store/useStore'
import { chooseStudyWord } from '../lib/study'

interface Props {
  roots: Root[]
  words: Word[]
  open: boolean
  onClose: () => void
  studyMode?: boolean
}

export default function Sidebar({ roots, words, open, onClose, studyMode = false }: Props) {
  const query = useStore((state) => state.query)
  const setQuery = useStore((state) => state.setQuery)
  const selectWord = useStore((state) => state.selectWord)
  const focusRoot = useStore((state) => state.focusRoot)
  const selectedWordId = useStore((state) => state.selectedWordId)
  const progress = useStore((state) => state.progress)
  const activeRow = useRef<HTMLButtonElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const rootById = useMemo(() => new Map(roots.map((root) => [root.id, root])), [roots])
  const mastered = useMemo(() => words.filter((word) => masteryOf(progress, word.id) === 'mastered').length, [words, progress])
  const pct = words.length ? Math.round((mastered / words.length) * 100) : 0
  const [onlyTodo, setOnlyTodo] = useState(false)

  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return words.filter((word) => {
      if (onlyTodo && masteryOf(progress, word.id) === 'mastered') return false
      if (!search) return true
      const root = rootById.get(word.rootId)
      return [word.word, word.def_zh, word.def_en, word.breakdown, root?.root, root?.meaning_zh, root?.meaning_en]
        .some((field) => field?.toLocaleLowerCase().includes(search))
    })
  }, [words, query, onlyTodo, progress, rootById])

  const byRoot = useMemo(() => {
    const map = new Map<string, Word[]>()
    for (const word of filtered) {
      const group = map.get(word.rootId) ?? []
      group.push(word)
      map.set(word.rootId, group)
    }
    return map
  }, [filtered])

  useEffect(() => {
    if (open) sidebar.current?.removeAttribute('inert')
    else sidebar.current?.setAttribute('inert', '')
    if (open) activeRow.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedWordId, open])

  function closeOnSmallScreen() {
    if (window.matchMedia('(max-width: 700px)').matches) onClose()
  }

  function openWord(id: string) {
    selectWord(id)
    closeOnSmallScreen()
  }

  return (
    <aside ref={sidebar} className={`sidebar${open ? '' : ' collapsed'}`} aria-label="单词目录" aria-hidden={!open}>
      <button type="button" className="nav-collapse" onClick={onClose} title="收起侧栏" aria-label="收起侧栏">
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
          <div className="prog-bar" role="progressbar" aria-label="已掌握单词" aria-valuemin={0} aria-valuemax={words.length} aria-valuenow={mastered}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      </header>

      <div className="side-tools">
        <div className="search-wrap">
          <svg viewBox="0 0 24 24" className="search-ic" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>
          <input
            className="search"
            aria-label="搜索单词、释义或词根"
            placeholder="搜索单词、释义或词根"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('')
              if (event.key === 'Enter' && filtered[0]) openWord(filtered[0].id)
            }}
          />
          {query && <button type="button" className="search-clear" aria-label="清空搜索" onClick={() => setQuery('')}>×</button>}
        </div>
        <button type="button" className={`todo-toggle${onlyTodo ? ' on' : ''}`} aria-pressed={onlyTodo} onClick={() => setOnlyTodo((value) => !value)}>
          只看未掌握
        </button>
        {(query.trim() || onlyTodo) && <p className="search-summary" role="status">找到 {filtered.length} 个单词</p>}
      </div>

      <div className="list">
        {filtered.length === 0 && <p className="search-empty">{onlyTodo && !query.trim() ? '这些词都掌握了，关闭筛选可以再复习。' : '没有找到，试试英文单词、中文释义或词根。'}</p>}
        {roots.map((root) => {
          const group = byRoot.get(root.id)
          if (!group?.length) return null
          return (
            <section key={root.id} className="root-group">
              <button type="button" className="root-head" onClick={() => {
                if (studyMode) {
                  const rootWords = words.filter((word) => word.rootId === root.id)
                  const next = chooseStudyWord(rootWords, useStore.getState().progress, { random: () => 0 }) ?? rootWords[0]
                  if (next) selectWord(next.id)
                } else focusRoot(root.id)
                closeOnSmallScreen()
              }} title={studyMode ? `学习词根 ${root.root} 的单词` : `查看词根 ${root.root} 的星系`}>
                <span className="root-dot" style={{ background: root.color }} />
                <span className="root-name">{root.root}</span>
                <span className="root-mean">{root.meaning_zh}</span>
              </button>
              {group.map((word) => {
                const mastery = masteryOf(progress, word.id)
                const active = word.id === selectedWordId
                return (
                  <button
                    type="button"
                    key={word.id}
                    ref={active ? activeRow : undefined}
                    className={`word-row${active ? ' active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    title={`${word.word} · ${word.def_zh}`}
                    onClick={() => openWord(word.id)}
                  >
                    <span className={`mk mk-${mastery}`} style={{ '--c': root.color } as CSSProperties} />
                    <span className="w">{word.word}</span>
                    <span className="zh">{word.def_zh}</span>
                  </button>
                )
              })}
            </section>
          )
        })}
      </div>
    </aside>
  )
}
