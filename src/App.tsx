import { lazy, Suspense, useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import WordCard from './components/WordCard'
import Controls from './components/Controls'
import Hud from './components/Hud'
import SceneBoundary from './components/SceneBoundary'
import { loadCatalog } from './lib/catalog'
import type { Catalog } from './lib/catalog'
import { useStore } from './store/useStore'

const StarMap = lazy(() => import('./components/StarMap'))
export type AppView = 'space' | 'study'
function initialView(): AppView {
  try {
    const saved = localStorage.getItem('star-vocab-view-v1')
    if (saved === 'study' || saved === 'space') return saved
  } catch { /* 不影响当前学习。 */ }
  return window.matchMedia('(max-width: 700px), (prefers-reduced-motion: reduce)').matches ? 'study' : 'space'
}
function supports3D() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch { return false }
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<AppView>(initialView)
  const [navOpen, setNavOpen] = useState(() => !window.matchMedia('(max-width: 700px)').matches)
  const [reviewOnly, setReviewOnly] = useState(false)
  const [graphicsAvailable] = useState(supports3D)
  const selectedWordId = useStore(s => s.selectedWordId)
  function changeView(next: AppView) {
    setView(next)
    try { localStorage.setItem('star-vocab-view-v1', next) } catch { /* 不影响当前模式。 */ }
  }
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    setError('')
    loadCatalog(import.meta.env.BASE_URL, controller.signal)
      .then(data => { if (active) setCatalog(data) })
      .catch(cause => {
        if (active) setError(controller.signal.aborted ? '加载有点久，请检查网络后重试。' :
          cause instanceof Error && /词库|词根|单词/.test(cause.message) ? cause.message : '词库加载失败，请检查网络后重试。')
      })
      .finally(() => window.clearTimeout(timeout))
    return () => { active = false; controller.abort(); window.clearTimeout(timeout) }
  }, [attempt])
  useEffect(() => {
    if (selectedWordId && window.matchMedia('(max-width: 700px)').matches) setNavOpen(false)
  }, [selectedWordId])

  if (!catalog) return (
    <main className="app app-loading">
      <div className="load-panel" role={error ? 'alert' : 'status'}>
        <span className="eyebrow">ROOT ATLAS</span>
        <h1>{error ? '暂时没能打开词库' : '正在准备你的词根星图'}</h1>
        <p>{error || '加载单词和学习资料…'}</p>
        {error && <button onClick={() => setAttempt(value => value + 1)}>重新加载</button>}
      </div>
    </main>
  )
  const { roots, words, wordLinks } = catalog
  const studyMode = view === 'study' || !graphicsAvailable
  return (
    <main className={`app${studyMode ? ' study-view' : ''}${navOpen ? ' nav-visible' : ''}`}>
      {!studyMode && (
        <SceneBoundary onFallback={() => changeView('study')}>
          <Suspense fallback={<div className="scene-loading" role="status">正在展开星空…你也可以先从词表选词。</div>}>
            <StarMap roots={roots} words={words} wordLinks={wordLinks} onUnavailable={() => changeView('study')} />
          </Suspense>
        </SceneBoundary>
      )}
      <div className="vignette" />
      <Hud roots={roots} words={words} />
      <Sidebar roots={roots} words={words} open={navOpen} onClose={() => setNavOpen(false)} studyMode={studyMode} />
      {!navOpen && <button className="nav-open" onClick={() => setNavOpen(true)} title="展开词表" aria-label="展开词表">
        <svg viewBox="0 0 24 24" aria-hidden><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="14" y2="17" /></svg>
      </button>}
      {!selectedWordId && <section className={`welcome${studyMode ? '' : ' space-welcome'}`}>
        <span className="eyebrow">{studyMode ? '每天记住一点' : '从一个词根出发'}</span>
        <h1>{studyMode ? '先回忆，再看答案' : '让单词在脑海里连起来'}</h1>
        <p>{studyMode ? '点击下方「开始学习」，或从词表挑一个单词。答完后会安排下次复习。' : '点一颗词根星，探索它的单词。拖动旋转，滚轮缩放；也可以搜索或切换专注学习。'}</p>
        {!graphicsAvailable && <p>这台设备使用省性能的专注模式，全部词汇和学习记录照常可用。</p>}
      </section>}
      <Controls words={words} view={studyMode ? 'study' : 'space'} onChangeView={changeView} graphicsAvailable={graphicsAvailable}
        reviewOnly={reviewOnly} onReviewOnly={setReviewOnly} />
      <WordCard roots={roots} words={words} wordLinks={wordLinks} studyMode={studyMode} reviewOnly={reviewOnly} />
    </main>
  )
}
