import { useMemo } from 'react'
import type { Root, Word } from '../types'
import { masteryOf, useStore } from '../store/useStore'

// 科技感 HUD：四角定位框 + 等宽数据读数
export default function Hud({ roots, words }: { roots: Root[]; words: Word[] }) {
  const progress = useStore((s) => s.progress)
  const mastered = useMemo(
    () => words.filter((w) => masteryOf(progress, w.id) === 'mastered').length,
    [words, progress],
  )

  return (
    <>
      <div className="hud-corner tl" />
      <div className="hud-corner tr" />
      <div className="hud-corner bl" />
      <div className="hud-corner br" />
      <div className="hud-stats">
        <span className="hud-dot" />
        <span>ROOT&nbsp;ATLAS</span>
        <span className="sep">//</span>
        <span>NODES <b>{words.length}</b></span>
        <span className="sep">//</span>
        <span>ROOTS <b>{roots.length}</b></span>
        <span className="sep">//</span>
        <span>SYNC <b>{mastered}</b></span>
      </div>
    </>
  )
}
