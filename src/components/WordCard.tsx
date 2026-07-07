import { useEffect, useMemo } from 'react'
import type { RelType, Root, Word, WordLink } from '../types'
import { masteryOf, useStore } from '../store/useStore'
import { REL } from '../lib/rel'
import { speak } from '../lib/speak'

interface Props {
  words: Word[]
  roots: Root[]
  wordLinks: WordLink[]
}

interface RelItem { type: RelType; other: string; note: string }

export default function WordCard({ words, roots, wordLinks }: Props) {
  const selectedWordId = useStore((s) => s.selectedWordId)
  const selectWord = useStore((s) => s.selectWord)
  const setMastery = useStore((s) => s.setMastery)
  const progress = useStore((s) => s.progress)

  const rels: RelItem[] = useMemo(() => {
    if (!selectedWordId) return []
    return wordLinks
      .filter((l) => l.a === selectedWordId || l.b === selectedWordId)
      .map((l) => ({ type: l.type, other: l.a === selectedWordId ? l.b : l.a, note: l.note }))
  }, [selectedWordId, wordLinks])

  const w = words.find((x) => x.id === selectedWordId)

  // 打开词卡自动朗读单词
  useEffect(() => {
    if (w) speak(w.word)
  }, [selectedWordId])

  if (!selectedWordId || !w) return null
  const root = roots.find((r) => r.id === w.rootId)
  const m = masteryOf(progress, w.id)

  // 掌握后自动飞到下一颗没背的星（先找同词根的，再找全局的）
  function pickNext(curId: string): string | null {
    const cur = words.find((x) => x.id === curId)!
    const todo = (id: string) => id !== curId && masteryOf(progress, id) !== 'mastered'
    const rootWords = words.filter((x) => x.rootId === cur.rootId)
    const ci = rootWords.findIndex((x) => x.id === curId)
    for (let k = 1; k <= rootWords.length; k++) {
      const x = rootWords[(ci + k) % rootWords.length]
      if (todo(x.id)) return x.id
    }
    const gi = words.findIndex((x) => x.id === curId)
    for (let k = 1; k <= words.length; k++) {
      const x = words[(gi + k) % words.length]
      if (todo(x.id)) return x.id
    }
    return null
  }
  function masterAndNext() {
    setMastery(w!.id, 'mastered')
    const next = pickNext(w!.id)
    if (next) setTimeout(() => selectWord(next), 540)
  }

  return (
    <div className="wordcard">
      <span className="close" onClick={() => selectWord(null)}>×</span>
      <h2>
        {w.word}
        <button className="spk" title="朗读单词" onClick={() => speak(w.word)}>🔊</button>
      </h2>
      <div className="phon">{w.phonetic}</div>
      <div className="pos">{w.pos}{root ? ` · 词根 ${root.root}（${root.meaning_zh}）` : ''}</div>

      <div className="def">{w.def_zh}</div>
      <div className="def-en">{w.def_en}</div>

      <div className="breakdown" style={{ borderColor: root?.color }}>
        🔭 {w.breakdown}
      </div>

      <div className="example" onClick={() => speak(w.example)} title="点击朗读例句" style={{ cursor: 'pointer' }}>
        “{w.example}” <span className="spk-mini">🔊</span>
      </div>

      {rels.length > 0 && (
        <div className="rels">
          <div className="rels-title">🔗 关系网（点词跳过去）</div>
          {rels.map((r, i) => {
            const ow = words.find((x) => x.id === r.other)
            return (
              <div className="rel-row" key={i}>
                <span className="rel-tag" style={{ background: REL[r.type].color }}>{REL[r.type].label}</span>
                <span className="rel-word" onClick={() => selectWord(r.other)}>{ow?.word ?? r.other}</span>
                <span className="rel-note">{r.note}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="actions">
        <button className={m === 'new' ? 'on' : ''} onClick={() => setMastery(w.id, 'new')}>没背</button>
        <button className={m === 'fuzzy' ? 'on' : ''} onClick={() => setMastery(w.id, 'fuzzy')}>模糊</button>
        <button className={m === 'mastered' ? 'on' : ''} onClick={masterAndNext}>已掌握</button>
      </div>
    </div>
  )
}
