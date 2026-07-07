import { useMemo } from 'react'
import type { Word } from '../types'
import { masteryOf, useStore } from '../store/useStore'

interface Props {
  words: Word[]
}

// 底部浮动操作条：随机抽一个还没背熟的词飞过去（轻量"考考我"）
export default function Controls({ words }: Props) {
  const progress = useStore((s) => s.progress)
  const selectWord = useStore((s) => s.selectWord)
  const focusRoot = useStore((s) => s.focusRoot)
  const bloom = useStore((s) => s.bloom)
  const toggleBloom = useStore((s) => s.toggleBloom)

  const pool = useMemo(
    () => words.filter((w) => masteryOf(progress, w.id) !== 'mastered'),
    [words, progress],
  )

  function randomWord() {
    const list = pool.length ? pool : words
    if (!list.length) return
    const pick = list[Math.floor(Math.random() * list.length)]
    focusRoot(null)
    // 先清空再选，保证就算重复点同一个也会重新飞 + 朗读
    selectWord(null)
    setTimeout(() => selectWord(pick.id), 40)
  }

  return (
    <div className="controls">
      <button onClick={randomWord}>🎲 随机背一个{pool.length ? ` · 剩 ${pool.length}` : ' · 全会了 🎉'}</button>
      <button onClick={toggleBloom} title="泛光后处理（低帧可关）">{bloom ? '✨ 泛光 开' : '✨ 泛光 关'}</button>
    </div>
  )
}
