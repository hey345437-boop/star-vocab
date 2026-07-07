import { create } from 'zustand'
import type { Mastery, Progress } from '../types'

const LS_KEY = 'star-vocab-progress-v1'

function load(): Record<string, Progress> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  } catch {
    return {}
  }
}

function save(p: Record<string, Progress>) {
  localStorage.setItem(LS_KEY, JSON.stringify(p))
}

interface State {
  progress: Record<string, Progress>
  selectedWordId: string | null
  focusRootId: string | null // 当前飞入的星系
  query: string
  bloom: boolean // 泛光后处理开关

  setMastery: (wordId: string, status: Mastery) => void
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
  selectWord: (id) => set({ selectedWordId: id }),
  focusRoot: (id) => set({ focusRootId: id }),
  setQuery: (q) => set({ query: q }),
  toggleBloom: () => set({ bloom: !get().bloom }),
}))

export function masteryOf(progress: Record<string, Progress>, id: string): Mastery {
  return progress[id]?.status ?? 'new'
}
