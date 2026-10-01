import { useEffect, useMemo, useState } from 'react'
import type { Word } from '../types'
import type { AppView } from '../App'
import { masteryOf, useStore } from '../store/useStore'
import { chooseStudyWord, getDueWords } from '../lib/study'
import ProgressTransfer from './ProgressTransfer'

interface Props {
  words: Word[]
  view: AppView
  onChangeView: (view: AppView) => void
  graphicsAvailable: boolean
  reviewOnly: boolean
  onReviewOnly: (value: boolean) => void
}
export default function Controls({ words, view, onChangeView, graphicsAvailable, reviewOnly, onReviewOnly }: Props) {
  const progress = useStore(s => s.progress)
  const selectWord = useStore(s => s.selectWord)
  const focusRoot = useStore(s => s.focusRoot)
  const selectedWordId = useStore(s => s.selectedWordId)
  const bloom = useStore(s => s.bloom)
  const toggleBloom = useStore(s => s.toggleBloom)
  const [now, setNow] = useState(Date.now)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    const refresh = () => setNow(Date.now())
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])
  const due = useMemo(() => getDueWords(words, progress, now), [words, progress, now])
  const remaining = useMemo(() => words.filter(word => masteryOf(progress, word.id) !== 'mastered').length, [words, progress])
  function start(review = false) {
    const pick = chooseStudyWord(words, progress, { currentWordId: selectedWordId, reviewOnly: review, now: Date.now() })
    if (pick) { onReviewOnly(review); selectWord(pick.id); setMessage('') }
    else setMessage(review ? '现在没有到期的单词，晚些时候再来复习。' : '这轮已经完成。可以从词表挑词，或等到期后复习。')
  }
  function overview() {
    selectWord(null)
    focusRoot(null)
    onReviewOnly(false)
    setMessage('')
  }
  return (
    <div className="controls progress-transfer-controls" aria-label="学习操作">
      <button className="primary-control" onClick={() => start(false)}>{view === 'study' ? '开始学习' : '随机背词'} · 待学 {remaining}</button>
      <button className={reviewOnly ? 'control-active' : ''} onClick={() => start(true)}>到期复习 · {due.length}</button>
      <button onClick={() => onChangeView(view === 'space' ? 'study' : 'space')} disabled={!graphicsAvailable && view === 'study'}>{view === 'space' ? '专注学习' : '探索星空'}</button>
      {view === 'space' && <>
        <button onClick={overview}>返回总览</button>
        <button onClick={toggleBloom} aria-pressed={bloom} title="关闭光效可降低电脑负担">光效{bloom ? '开' : '关'}</button>
      </>}
      <ProgressTransfer words={words} />
      {message && <p className="control-message" role="status">{message}</p>}
    </div>
  )
}
