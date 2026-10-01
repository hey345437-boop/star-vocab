import { create } from 'zustand'
import type { Mastery, Progress } from '../types'
import { PROGRESS_STORAGE_KEY, validateProgress } from '../lib/progressTransfer'
import { scheduleReview, updateMastery } from '../lib/study'
import type { ReviewRating } from '../lib/study'

const RECOVERY_STORAGE_KEY = 'star-vocab-progress-recovery-v1'

function readStoredProgress() {
  const raw = localStorage.getItem(PROGRESS_STORAGE_KEY)
  if (!raw) return { raw, progress: {} as Record<string, Progress>, damaged: false }
  try {
    return { raw, progress: validateProgress(JSON.parse(raw)), damaged: false }
  } catch {
    const progress: Record<string, Progress> = {}
    try {
      const stored: unknown = JSON.parse(raw)
      if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
        // 一条坏记录不能让其余已背单词消失。
        for (const [wordId, entry] of Object.entries(stored)) {
          try { Object.assign(progress, validateProgress({ [wordId]: entry })) } catch { /* 原文在保存前另存。 */ }
        }
      }
    } catch { /* 留住原文，等待用户保存前做恢复备份。 */ }
    return { raw, progress, damaged: true }
  }
}

function load(): Record<string, Progress> {
  try { return readStoredProgress().progress } catch { return {} }
}

function saveChanges(changes: Record<string, Progress>): Record<string, Progress> {
  const stored = readStoredProgress()
  // 保存前读最新内容，避免另一标签页刚背好的单词被旧页面覆盖。
  const progress = { ...useStore.getState().progress, ...stored.progress, ...changes }
  if (stored.damaged && stored.raw) localStorage.setItem(RECOVERY_STORAGE_KEY, stored.raw)
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress))
  return progress
}

interface State {
  progress: Record<string, Progress>
  progressError: string | null
  selectedWordId: string | null
  focusRootId: string | null
  navigationNonce: number
  query: string
  bloom: boolean
  setMastery: (wordId: string, status: Mastery) => boolean
  reviewWord: (wordId: string, rating: ReviewRating) => boolean
  clearProgressError: () => void
  importProgress: (progress: unknown, knownWordIds: ReadonlySet<string>) => number
  selectWord: (id: string | null) => void
  focusRoot: (id: string | null) => void
  setQuery: (q: string) => void
  toggleBloom: () => void
}

const saveError = '这次进度没能保存，原有记录还在。请允许浏览器保存网站数据，或先导出进度文件再重试。'

export const useStore = create<State>((set, get) => ({
  progress: load(),
  progressError: null,
  selectedWordId: null,
  focusRootId: null,
  navigationNonce: 0,
  query: '',
  bloom: false,

  setMastery: (wordId, status) => {
    try {
      validateProgress({ [wordId]: { status } })
      const latest = readStoredProgress().progress[wordId]
      const changes = validateProgress({ [wordId]: updateMastery(latest, status) })
      const progress = saveChanges(changes)
      set({ progress, progressError: null })
      return true
    } catch {
      set({ progressError: saveError })
      return false
    }
  },
  reviewWord: (wordId, rating) => {
    try {
      if (rating !== 'forgot' && rating !== 'remembered') throw new Error('Invalid review rating')
      const latest = readStoredProgress().progress[wordId]
      const changes = validateProgress({ [wordId]: scheduleReview(latest, rating) })
      const progress = saveChanges(changes)
      set({ progress, progressError: null })
      return true
    } catch {
      set({ progressError: saveError })
      return false
    }
  },
  clearProgressError: () => set({ progressError: null }),
  importProgress: (incoming, knownWordIds) => {
    const imported = validateProgress(incoming, knownWordIds)
    const progress = saveChanges(imported)
    set({ progress, progressError: null })
    return Object.keys(imported).length
  },
  selectWord: (id) => set((state) => ({ selectedWordId: id, ...(id ? { focusRootId: null } : {}), navigationNonce: state.navigationNonce + 1, progressError: null })),
  focusRoot: (id) => set((state) => ({ focusRootId: id, ...(id ? { selectedWordId: null } : {}), navigationNonce: state.navigationNonce + 1 })),
  setQuery: (query) => set({ query }),
  toggleBloom: () => set({ bloom: !get().bloom }),
}))

// 多个窗口同时学习时，另一窗口保存后同步显示；坏记录仍按原规则保留。
if (typeof window !== 'undefined') {
  const syncProgress = (event: StorageEvent) => {
    if (event.key === PROGRESS_STORAGE_KEY || event.key === null) useStore.setState({ progress: load() })
  }
  window.addEventListener('storage', syncProgress)
  import.meta.hot?.dispose(() => window.removeEventListener('storage', syncProgress))
}

export function masteryOf(progress: Record<string, Progress>, id: string): Mastery {
  return progress[id]?.status ?? 'new'
}
