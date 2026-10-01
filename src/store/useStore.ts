import { create } from 'zustand'
import type { Mastery, Progress } from '../types'
import { PROGRESS_STORAGE_KEY, validateProgress } from '../lib/progressTransfer'

function load(): Record<string, Progress> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}')
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
    const progress: Record<string, Progress> = {}
    // 旧记录逐条读取，一条损坏的记录不会让其他已背单词消失。
    for (const [wordId, entry] of Object.entries(stored)) {
      try {
        Object.assign(progress, validateProgress({ [wordId]: entry }))
      } catch {
        // 下次保存前，save() 会另存原文以便恢复。
      }
    }
    return progress
  } catch {
    return {}
  }
}

function save(p: Record<string, Progress>) {
  const previous = localStorage.getItem(PROGRESS_STORAGE_KEY)
  if (previous) {
    let needsRecovery = false
    try { validateProgress(JSON.parse(previous)) } catch { needsRecovery = true }
    if (needsRecovery) {
      // 原文备份写不进去时，也不要覆盖旧进度。
      localStorage.setItem('star-vocab-progress-recovery-v1', previous)
    }
  }
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(p))
}

interface State {
  progress: Record<string, Progress>
  selectedWordId: string | null
  focusRootId: string | null // 当前飞入的星系
  query: string
  bloom: boolean // 泛光后处理开关

  setMastery: (wordId: string, status: Mastery) => void
  importProgress: (progress: unknown, knownWordIds: ReadonlySet<string>) => number
  selectWord: (id: string | null) => void
  focusRoot: (id: string | null) => void
  setQuery: (q: string) => void
  toggleBloom: () => void
}

export const useStore = create<State>((set, get) => ({
  progress: load(),
  selectedWordId: null,
  focusRootId: null,
  query: '',
  bloom: true,

  setMastery: (wordId, status) => {
    const progress = { ...get().progress, [wordId]: { ...get().progress[wordId], status } }
    save(progress)
    set({ progress })
  },
  importProgress: (incoming, knownWordIds) => {
    const imported = validateProgress(incoming, knownWordIds)
    const progress = { ...get().progress, ...imported }
    // 先保存，保存失败时保留原来的界面和进度。
    save(progress)
    set({ progress })
    return Object.keys(imported).length
  },
  selectWord: (id) => set({ selectedWordId: id }),
  focusRoot: (id) => set({ focusRootId: id }),
  setQuery: (q) => set({ query: q }),
  toggleBloom: () => set({ bloom: !get().bloom }),
}))

export function masteryOf(progress: Record<string, Progress>, id: string): Mastery {
  return progress[id]?.status ?? 'new'
}
