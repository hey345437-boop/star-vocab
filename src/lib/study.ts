import type { Mastery, Progress, Word } from '../types'

export type ReviewRating = 'forgot' | 'remembered'

export function getDueWords(words: readonly Word[], progress: Record<string, Progress>, now = Date.now()): Word[] {
  return words.filter((word) => {
    const record = progress[word.id]
    if (!record || record.status === 'new') return false
    // 旧版本只有掌握度的记录也能进入复习，复习后补上日期。
    return !record.srs || Date.parse(record.srs.due) <= now
  })
}

interface StudyChoice {
  currentWordId?: string | null
  reviewOnly?: boolean
  now?: number
  random?: () => number
}

export function chooseStudyWord(words: readonly Word[], progress: Record<string, Progress>, options: StudyChoice = {}): Word | null {
  const due = getDueWords(words, progress, options.now)
  const unlearned = words.filter((word) => !progress[word.id] || progress[word.id].status === 'new')
  const candidates = options.reviewOnly ? due : due.length ? due : unlearned
  const others = candidates.filter((word) => word.id !== options.currentWordId)
  const pool = others.length ? others : candidates
  if (!pool.length) return null
  const value = (options.random ?? Math.random)()
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * pool.length)))
  return pool[index]
}

export function nextUnfinishedWord(words: readonly Word[], progress: Record<string, Progress>, currentWordId: string): Word | null {
  const current = words.find((word) => word.id === currentWordId)
  if (!current) return null
  const groups = [words.filter((word) => word.rootId === current.rootId), words]
  for (const group of groups) {
    const start = group.findIndex((word) => word.id === currentWordId)
    for (let offset = 1; offset < group.length; offset++) {
      const word = group[(start + offset) % group.length]
      const record = progress[word.id]
      if (word.id !== currentWordId && (!record || record.status === 'new' || (record.status === 'fuzzy' && (!record.srs || Date.parse(record.srs.due) <= Date.now())))) return word
    }
  }
  return null
}

export function scheduleReview(previous: Progress | undefined, rating: ReviewRating, now = Date.now()): Progress {
  const ease = previous?.srs?.ease ?? 2.5
  if (rating === 'forgot') {
    return {
      status: 'fuzzy',
      srs: { due: new Date(now + 10 * 60_000).toISOString(), interval: 10 / 1440, ease: Math.max(1.3, ease - 0.2), reps: 0 },
    }
  }
  const reps = Math.min(Number.MAX_SAFE_INTEGER, (previous?.srs?.reps ?? 0) + 1)
  const earlyIntervals = [1, 3, 7, 14, 30]
  const interval = reps <= earlyIntervals.length
    ? earlyIntervals[reps - 1]
    : Math.min(365, Math.max(30, Math.round((previous?.srs?.interval ?? 30) * ease)))
  return { status: 'mastered', srs: { due: new Date(now + interval * 86_400_000).toISOString(), interval, ease, reps } }
}

export function updateMastery(previous: Progress | undefined, status: Mastery, now = Date.now()): Progress {
  if (status === 'new') return { status }
  return scheduleReview(previous, status === 'mastered' ? 'remembered' : 'forgot', now)
}
