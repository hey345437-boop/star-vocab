import type { Mastery, Progress } from '../types'

export const PROGRESS_STORAGE_KEY = 'star-vocab-progress-v1'
export const MAX_PROGRESS_FILE_BYTES = 5 * 1024 * 1024

interface ProgressBackup {
  format: 'star-vocab-progress'
  version: 1
  exportedAt: string
  progress: Record<string, Progress>
}

const statuses: Mastery[] = ['new', 'fuzzy', 'mastered']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readProgress(value: unknown, wordId: string): Progress {
  if (!isRecord(value) || !statuses.includes(value.status as Mastery)) {
    throw new Error(`单词 ${wordId} 的掌握状态不正确。`)
  }
  const result: Progress = { status: value.status as Mastery }
  if (value.srs !== undefined) {
    const srs = value.srs
    if (
      !isRecord(srs) ||
      typeof srs.due !== 'string' || !Number.isFinite(Date.parse(srs.due)) ||
      typeof srs.interval !== 'number' || !Number.isFinite(srs.interval) || srs.interval < 0 ||
      typeof srs.ease !== 'number' || !Number.isFinite(srs.ease) || srs.ease <= 0 ||
      typeof srs.reps !== 'number' || !Number.isSafeInteger(srs.reps) || srs.reps < 0
    ) {
      throw new Error(`单词 ${wordId} 的复习记录不正确。`)
    }
    result.srs = { due: srs.due, interval: srs.interval, ease: srs.ease, reps: srs.reps }
  }
  return result
}

export function validateProgress(
  value: unknown,
  knownWordIds?: ReadonlySet<string>,
): Record<string, Progress> {
  if (!isRecord(value)) throw new Error('文件里的学习进度格式不正确。')
  const progress: Record<string, Progress> = {}
  for (const [wordId, entry] of Object.entries(value)) {
    if (
      !wordId || wordId === '__proto__' || wordId === 'constructor' || wordId === 'prototype' ||
      (knownWordIds && !knownWordIds.has(wordId))
    ) {
      throw new Error(`文件中的单词 ${wordId || '（空）'} 不在当前词库中。请先使用与备份相同的项目版本。`)
    }
    progress[wordId] = readProgress(entry, wordId)
  }
  return progress
}

export function createProgressBackup(progress: Record<string, Progress>, now = new Date()): string {
  const backup: ProgressBackup = {
    format: 'star-vocab-progress',
    version: 1,
    exportedAt: now.toISOString(),
    progress: validateProgress(progress),
  }
  return JSON.stringify(backup, null, 2)
}

export function parseProgressBackup(text: string, knownWordIds: ReadonlySet<string>): Record<string, Progress> {
  let value: unknown
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('这个文件无法读取。请选择「保存进度文件」生成的 JSON 文件。')
  }
  if (!isRecord(value) || value.format !== 'star-vocab-progress') {
    throw new Error('这不是星词的进度备份文件。')
  }
  if (value.version !== 1) throw new Error('这个备份版本暂不支持。请使用生成备份时的项目版本。')
  if (typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))) {
    throw new Error('备份文件缺少正确的导出日期。')
  }
  return validateProgress(value.progress, knownWordIds)
}
