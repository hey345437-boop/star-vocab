import { useEffect, useMemo, useRef, useState } from 'react'
import type { Mastery, RelType, Root, Word, WordLink } from '../types'
import { masteryOf, useStore } from '../store/useStore'
import { REL } from '../lib/rel'
import { speak, stopSpeaking } from '../lib/speak'
import { chooseStudyWord, nextUnfinishedWord } from '../lib/study'
import type { ReviewRating } from '../lib/study'

interface Props {
  words: Word[]
  roots: Root[]
  wordLinks: WordLink[]
  studyMode?: boolean
  reviewOnly?: boolean
}

interface RelItem { type: RelType; other: string; note: string }

export default function WordCard({ words, roots, wordLinks, studyMode = false, reviewOnly = false }: Props) {
  const selectedWordId = useStore((state) => state.selectedWordId)
  const navigationNonce = useStore((state) => state.navigationNonce)
  const selectWord = useStore((state) => state.selectWord)
  const setMastery = useStore((state) => state.setMastery)
  const reviewWord = useStore((state) => state.reviewWord)
  const progress = useStore((state) => state.progress)
  const progressError = useStore((state) => state.progressError)
  const [answerKey, setAnswerKey] = useState<string | null>(null)
  const selectionKey = `${selectedWordId}:${navigationNonce}:${studyMode}:${reviewOnly}`
  const answerVisible = answerKey === selectionKey
  const [message, setMessage] = useState('')
  const [speechFailed, setSpeechFailed] = useState(false)
  const [rated, setRated] = useState(false)
  const nextTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wordById = useMemo(() => new Map(words.map((word) => [word.id, word])), [words])
  const rootById = useMemo(() => new Map(roots.map((root) => [root.id, root])), [roots])
  const word = selectedWordId ? wordById.get(selectedWordId) : undefined
  const rels: RelItem[] = useMemo(() => {
    if (!selectedWordId) return []
    return wordLinks
      .filter((link) => link.a === selectedWordId || link.b === selectedWordId)
      .map((link) => ({ type: link.type, other: link.a === selectedWordId ? link.b : link.a, note: link.note }))
      .filter((link) => wordById.has(link.other))
  }, [selectedWordId, wordLinks, wordById])

  function cancelPendingNext() {
    if (nextTimer.current !== null) clearTimeout(nextTimer.current)
    nextTimer.current = null
  }

  useEffect(() => {
    setAnswerKey(null)
    setMessage('')
    setRated(false)
    setSpeechFailed(false)
    cancelPendingNext()
    if (word) speak(word.word)
    return () => {
      cancelPendingNext()
      stopSpeaking()
    }
  }, [word?.id, navigationNonce, studyMode, reviewOnly])

  function pronounce(text: string) {
    const request = useStore.getState().navigationNonce
    const fail = () => {
      if (useStore.getState().navigationNonce === request) setSpeechFailed(true)
    }
    setSpeechFailed(false)
    if (!speak(text, 0.92, fail)) fail()
  }

  function goNext() {
    if (!word) return
    cancelPendingNext()
    const latest = useStore.getState().progress
    const next = studyMode
      ? chooseStudyWord(words, latest, { currentWordId: word.id, reviewOnly })
      : nextUnfinishedWord(words, latest, word.id)
    if (next && next.id !== word.id) selectWord(next.id)
    else setMessage(reviewOnly ? '本轮到期复习完成了。忘记的词会在 10 分钟后再出现。' : '这一轮完成了！可以换个词根，或稍后回来复习。')
  }

  function advanceAfterFeedback() {
    cancelPendingNext()
    const request = useStore.getState().navigationNonce
    nextTimer.current = setTimeout(() => {
      nextTimer.current = null
      // 关闭、重选或切换词根后，旧定时器不能把用户拉回去。
      if (useStore.getState().selectedWordId === word?.id && useStore.getState().navigationNonce === request) goNext()
    }, 550)
  }

  function mark(status: Mastery) {
    if (!word) return
    if (status === 'mastered' && rated) return
    cancelPendingNext()
    setRated(false)
    if (!setMastery(word.id, status)) return
    setMessage(status === 'mastered' ? '已保存，接着背下一个。' : status === 'fuzzy' ? '已保存，10 分钟后再复习。' : '已保存为没背。')
    if (status === 'mastered') {
      setRated(true)
      advanceAfterFeedback()
    }
  }

  function rate(rating: ReviewRating) {
    if (!word || !answerVisible || rated) return
    if (!reviewWord(word.id, rating)) return
    setRated(true)
    const saved = useStore.getState().progress[word.id]
    setMessage(rating === 'forgot' ? '记下了，10 分钟后再复习这个词。' : `记下了，${saved.srs?.interval ?? 1} 天后再复习这个词。`)
    advanceAfterFeedback()
  }

  useEffect(() => {
    if (!word) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const nativeAction = Boolean(target?.closest('button, a, [role="button"]'))
      if (event.key === 'Escape') {
        event.preventDefault()
        selectWord(null)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      } else if (studyMode && !nativeAction && (event.key === ' ' || event.key === 'Enter') && !answerVisible) {
        event.preventDefault()
        setAnswerKey(selectionKey)
      } else if (studyMode && answerVisible && event.key === '1') {
        event.preventDefault()
        rate('forgot')
      } else if (studyMode && answerVisible && event.key === '2') {
        event.preventDefault()
        rate('remembered')
      } else if (!studyMode && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault()
        mark(({ '1': 'new', '2': 'fuzzy', '3': 'mastered' } as const)[event.key as '1' | '2' | '3'])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [word, studyMode, answerVisible, rated, words, reviewOnly])

  if (!word) return null
  const root = rootById.get(word.rootId)
  const mastery = masteryOf(progress, word.id)
  const showAnswer = !studyMode || answerVisible

  return (
    <section className={`wordcard${studyMode ? ' study-card' : ''}`} aria-label={studyMode ? '单词自测' : '单词详情'}>
      <button type="button" className="close" aria-label="关闭词卡" onClick={() => selectWord(null)}>×</button>
      {studyMode && <div className="study-card-label">{reviewOnly ? '到期复习' : '单词自测'}</div>}
      <h2>
        {word.word}
        <button type="button" className="spk" title="朗读单词" aria-label="朗读单词" onClick={() => pronounce(word.word)}>🔊</button>
      </h2>
      <div className="phon">{word.phonetic}</div>
      {speechFailed && <p className="wordcard-message" role="status">当前浏览器没有可用的英语读音，可以继续看音标学习。</p>}

      {showAnswer ? (
        <>
          <div className="pos">{word.pos}{root ? ` · 词根 ${root.root}（${root.meaning_zh}）` : ''}</div>
          <div className="def">{word.def_zh}</div>
          <div className="def-en">{word.def_en}</div>
          <div className="breakdown" style={{ borderColor: root?.color }}>🔭 {word.breakdown}</div>
          <button type="button" className="example" onClick={() => pronounce(word.example)} title="朗读例句">
            “{word.example}” <span className="spk-mini">🔊</span>
          </button>
          {rels.length > 0 && (
            <div className="rels">
              <div className="rels-title">🔗 关系网（点词跳过去）</div>
              {rels.map((relation) => (
                <div className="rel-row" key={`${relation.type}:${relation.other}`}>
                  <span className="rel-tag" style={{ background: REL[relation.type].color }}>{REL[relation.type].label}</span>
                  <button type="button" className="rel-word" onClick={() => selectWord(relation.other)}>{wordById.get(relation.other)?.word}</button>
                  <span className="rel-note">{relation.note}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="study-prompt">
          <p>先想一想：这个词是什么意思？</p>
          <button type="button" className="show-answer" onClick={() => setAnswerKey(selectionKey)}>看答案</button>
        </div>
      )}

      {studyMode ? showAnswer && (
        <div className="actions study-actions">
          <button type="button" onClick={() => rate('forgot')} disabled={rated}>忘了</button>
          <button type="button" onClick={() => rate('remembered')} disabled={rated}>想起来了</button>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className={mastery === 'new' ? 'on' : ''} onClick={() => mark('new')}>没背</button>
          <button type="button" className={mastery === 'fuzzy' ? 'on' : ''} onClick={() => mark('fuzzy')}>模糊</button>
          <button type="button" className={mastery === 'mastered' ? 'on' : ''} onClick={() => mark('mastered')} disabled={rated}>已掌握</button>
        </div>
      )}
      <div className="wordcard-footer">
        <button type="button" className="next-word" onClick={goNext}>下一个 →</button>
        <span>{studyMode ? '空格看答案 · 1 忘了 · 2 想起来了' : '1 没背 · 2 模糊 · 3 掌握'} · → 下一词 · Esc 关闭</span>
      </div>
      {progressError && <p className="wordcard-error" role="alert">{progressError}</p>}
      {message && <p className="wordcard-message" role="status">{message}</p>}
    </section>
  )
}
