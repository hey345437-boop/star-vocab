import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const storageKey = 'star-vocab-progress-v1'
const recoveryKey = 'star-vocab-progress-recovery-v1'
const entries = new Map()
let failedWrite = null
let failedRead = false
globalThis.localStorage = {
  getItem(key) {
    if (failedRead) throw new Error('Storage unavailable')
    return entries.get(key) ?? null
  },
  setItem(key, value) {
    if (key === failedWrite) throw new Error('Storage full')
    entries.set(key, String(value))
  },
}

const result = await build({
  stdin: {
    contents: "export { useStore, masteryOf } from './src/store/useStore'; export * from './src/lib/study'; export * from './src/lib/progressTransfer'; export * from './src/lib/speak'",
    resolveDir: project,
    sourcefile: 'learning-check.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  define: { 'import.meta.hot': 'undefined' },
})
const { useStore, masteryOf, chooseStudyWord, getDueWords, nextUnfinishedWord, scheduleReview, createProgressBackup, parseProgressBackup, speak, stopSpeaking } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
const words = JSON.parse(fs.readFileSync(path.join(project, 'public/data/words.json'), 'utf8'))
const knownWordIds = new Set(words.map((word) => word.id))
const first = words[0]
const second = words[1]
const now = Date.parse('2026-10-01T00:00:00.000Z')

let checked = 0
function check(name, action) {
  action()
  checked++
  console.log(`通过：${name}`)
}
function reset(progress = {}) {
  entries.clear()
  failedWrite = null
  failedRead = false
  entries.set(storageKey, JSON.stringify(progress))
  useStore.setState({ progress, progressError: null, selectedWordId: null, focusRootId: null, navigationNonce: 0 })
}

check('选词与聚焦互不冲突，同词重选能再次导航', () => {
  reset()
  useStore.getState().focusRoot(first.rootId)
  const nonce = useStore.getState().navigationNonce
  useStore.getState().selectWord('scope')
  assert.equal(useStore.getState().focusRootId, null)
  assert.equal(useStore.getState().selectedWordId, 'scope')
  assert.equal(useStore.getState().navigationNonce, nonce + 1)
  useStore.getState().selectWord('scope')
  assert.equal(useStore.getState().navigationNonce, nonce + 2)
  useStore.getState().focusRoot(first.rootId)
  assert.equal(useStore.getState().selectedWordId, null)
  useStore.getState().selectWord(null)
  assert.equal(useStore.getState().focusRootId, first.rootId)
})

check('掌握、模糊、没背都保存并更新复习日期', () => {
  reset()
  assert.equal(useStore.getState().setMastery(first.id, 'mastered'), true)
  assert.equal(useStore.getState().progress[first.id].srs.interval, 1)
  assert.equal(useStore.getState().reviewWord(first.id, 'remembered'), true)
  assert.equal(useStore.getState().progress[first.id].srs.interval, 3)
  assert.equal(useStore.getState().reviewWord(first.id, 'forgot'), true)
  assert.equal(masteryOf(useStore.getState().progress, first.id), 'fuzzy')
  assert.equal(useStore.getState().progress[first.id].srs.reps, 0)
  assert.equal(useStore.getState().setMastery(first.id, 'new'), true)
  assert.deepEqual(useStore.getState().progress[first.id], { status: 'new' })
  assert.deepEqual(JSON.parse(entries.get(storageKey)), useStore.getState().progress)
})

check('旧进度可复习、未来的进度不会提前出现在到期池', () => {
  const progress = {
    [first.id]: { status: 'mastered' },
    [second.id]: scheduleReview(undefined, 'remembered', now),
  }
  assert.deepEqual(getDueWords(words, progress, now).map((word) => word.id), [first.id])
  assert.equal(chooseStudyWord(words, progress, { now, reviewOnly: true, random: () => 0 }).id, first.id)
  assert.equal(chooseStudyWord(words, { [second.id]: progress[second.id] }, { now, reviewOnly: true }), null)
  assert.ok(getDueWords(words, progress, now + 86_400_000).some((word) => word.id === second.id))
})

check('先复习、避免连续重复、优先同词根的下一词', () => {
  const progress = { [first.id]: { status: 'fuzzy' } }
  assert.equal(chooseStudyWord(words, progress, { now, random: () => 0 }).id, first.id)
  assert.notEqual(chooseStudyWord(words, {}, { currentWordId: first.id, random: () => 0 }).id, first.id)
  assert.equal(nextUnfinishedWord(words, {}, first.id).rootId, first.rootId)
  const complete = Object.fromEntries(words.map((word) => [word.id, { status: 'mastered' }]))
  assert.equal(nextUnfinishedWord(words, complete, first.id), null)
  assert.equal(nextUnfinishedWord([], {}, first.id), null)
})

check('遗忘后十分钟再出现，正确后复习间隔逐渐拉长', () => {
  const forgot = scheduleReview(undefined, 'forgot', now)
  assert.equal(Date.parse(forgot.srs.due), now + 600_000)
  assert.equal(getDueWords([first], { [first.id]: forgot }, now).length, 0)
  assert.equal(getDueWords([first], { [first.id]: forgot }, now + 600_000).length, 1)
  let previous
  for (const interval of [1, 3, 7, 14, 30, 75]) {
    previous = scheduleReview(previous, 'remembered', now)
    assert.equal(previous.srs.interval, interval)
  }
})

check('另一标签页的新记录不会被旧页面覆盖', () => {
  reset({ [first.id]: { status: 'new' } })
  entries.set(storageKey, JSON.stringify({ [first.id]: { status: 'new' }, [second.id]: { status: 'mastered' } }))
  assert.equal(useStore.getState().setMastery(first.id, 'fuzzy'), true)
  assert.equal(useStore.getState().progress[second.id].status, 'mastered')
  assert.equal(JSON.parse(entries.get(storageKey))[second.id].status, 'mastered')
})

check('保存被拒绝时不改进度，并返回可显示的错误', () => {
  reset({ [first.id]: { status: 'new' } })
  const original = entries.get(storageKey)
  failedWrite = storageKey
  assert.equal(useStore.getState().setMastery(first.id, 'mastered'), false)
  assert.equal(useStore.getState().progress[first.id].status, 'new')
  assert.equal(entries.get(storageKey), original)
  assert.ok(useStore.getState().progressError)
  failedWrite = null
  failedRead = true
  assert.equal(useStore.getState().reviewWord(first.id, 'remembered'), false)
  assert.equal(entries.get(storageKey), original)
  failedRead = false
})

check('坏旧记录保留原文，恢复副本保存失败时禁止覆盖', () => {
  reset({ [first.id]: { status: 'mastered' } })
  const damaged = JSON.stringify({ [first.id]: { status: 'mastered' }, bad: { status: 'wrong' } })
  entries.set(storageKey, damaged)
  failedWrite = recoveryKey
  assert.equal(useStore.getState().setMastery(second.id, 'fuzzy'), false)
  assert.equal(entries.get(storageKey), damaged)
  failedWrite = null
  assert.equal(useStore.getState().setMastery(second.id, 'fuzzy'), true)
  assert.equal(entries.get(recoveryKey), damaged)
  assert.equal(useStore.getState().progress[first.id].status, 'mastered')
  assert.equal(useStore.getState().progress.bad, undefined)
})

check('导入保留其他记录，错误文件不写入，Windows格式可往返', () => {
  reset({ [second.id]: { status: 'fuzzy' } })
  const imported = { [first.id]: scheduleReview(undefined, 'remembered', now) }
  const text = createProgressBackup(imported, new Date(now))
  const parsed = parseProgressBackup('\uFEFF' + text.replaceAll('\n', '\r\n'), knownWordIds)
  assert.deepEqual(parsed, imported)
  assert.equal(useStore.getState().importProgress(parsed, knownWordIds), 1)
  assert.equal(useStore.getState().progress[second.id].status, 'fuzzy')
  const before = entries.get(storageKey)
  assert.throws(() => useStore.getState().importProgress({ unknown: { status: 'mastered' } }, knownWordIds))
  assert.equal(entries.get(storageKey), before)
  assert.throws(() => parseProgressBackup('{broken}', knownWordIds))
  assert.equal(entries.get(storageKey), before)
})

check('无语音支持或空词时安全返回，不阻止学习', () => {
  assert.equal(speak(first.word), false)
  assert.equal(speak(''), false)
  assert.doesNotThrow(() => stopSpeaking())
})

check('非法状态和复习评分不能写进进度', () => {
  reset()
  assert.equal(useStore.getState().setMastery(first.id, 'unknown'), false)
  assert.equal(useStore.getState().reviewWord(first.id, 'unknown'), false)
  assert.deepEqual(JSON.parse(entries.get(storageKey)), {})
})

console.log(`学习与存储检查完成：${checked} 项通过。`)
