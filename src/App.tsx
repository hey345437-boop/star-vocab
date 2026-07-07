import { useEffect, useState } from 'react'
import type { Root, Word, WordLink } from './types'
import StarMap from './components/StarMap'
import Sidebar from './components/Sidebar'
import WordCard from './components/WordCard'
import Controls from './components/Controls'
import Hud from './components/Hud'

export default function App() {
  const [roots, setRoots] = useState<Root[]>([])
  const [words, setWords] = useState<Word[]>([])
  const [wordLinks, setWordLinks] = useState<WordLink[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(true)

  useEffect(() => {
    const base = import.meta.env.BASE_URL
    Promise.all([
      fetch(`${base}data/roots.json`).then((r) => r.json()),
      fetch(`${base}data/words.json`).then((r) => r.json()),
      fetch(`${base}data/wordlinks.json`).then((r) => r.json()),
    ])
      .then(([r, w, l]) => {
        setRoots(r)
        setWords(w)
        setWordLinks(l)
      })
      .catch((e) => setErr(String(e)))
  }, [])

  return (
    <div className="app">
      {err && <div className="hint" style={{ color: '#F7768E' }}>数据加载失败：{err}</div>}
      {roots.length > 0 && <StarMap roots={roots} words={words} wordLinks={wordLinks} />}
      <div className="vignette" />
      {roots.length > 0 && <Hud roots={roots} words={words} />}
      {roots.length > 0 && <Sidebar roots={roots} words={words} open={navOpen} onClose={() => setNavOpen(false)} />}
      {roots.length > 0 && !navOpen && (
        <button className="nav-open" onClick={() => setNavOpen(true)} title="展开侧栏" aria-label="展开侧栏">
          <svg viewBox="0 0 24 24" aria-hidden><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="14" y2="17" /></svg>
        </button>
      )}
      {roots.length > 0 && <Controls words={words} />}
      <WordCard roots={roots} words={words} wordLinks={wordLinks} />
    </div>
  )
}
