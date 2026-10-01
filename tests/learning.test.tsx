// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root as ReactRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WordCard from '../src/components/WordCard'
import Sidebar from '../src/components/Sidebar'
import { useStore } from '../src/store/useStore'
import { chooseStudyWord, scheduleReview } from '../src/lib/study'
import { PROGRESS_STORAGE_KEY } from '../src/lib/progressTransfer'
import type { Root, Word } from '../src/types'

const roots: Root[] = [
  { id: 'spect', root: 'spect / spic', meaning_en: 'see', meaning_zh: '看', color: '#4B90FF', origin: 'Latin' },
  { id: 'scope', root: 'scope', meaning_en: 'look', meaning_zh: '观察', color: '#FF906B', origin: 'Greek' },
]
const words: Word[] = [
  { id: 'inspect', word: 'inspect', rootId: 'spect', phonetic: '/ɪnˈspekt/', pos: 'v.', def_en: 'to examine carefully', def_zh: '检查', breakdown: 'in + spect → 检查', example: 'We inspect the house.' },
  { id: 'prospect', word: 'prospect', rootId: 'spect', phonetic: '/ˈprɒspekt/', pos: 'n.', def_en: 'a future possibility', def_zh: '前景', breakdown: 'pro + spect → 前景', example: 'The prospect is good.' },
  { id: 'scope', word: 'scope', rootId: 'scope', phonetic: '/skəʊp/', pos: 'n.', def_en: 'range', def_zh: '范围', breakdown: 'scope → 范围', example: 'The scope is wide.' },
]

let container: HTMLDivElement
let root: ReactRoot

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  localStorage.clear()
  useStore.setState({ progress: {}, progressError: null, selectedWordId: words[0].id, focusRootId: null, navigationNonce: 0, query: '' })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) })
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function mountCard(studyMode = false, reviewOnly = false) {
  act(() => root.render(<WordCard roots={roots} words={words} wordLinks={[]} studyMode={studyMode} reviewOnly={reviewOnly} />))
}
function button(text: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)
  if (!result) throw new Error(`Button missing: ${text}`)
  return result
}
function click(element: HTMLElement) {
  act(() => {
    element.focus()
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}
function key(element: HTMLElement, value: string, options: KeyboardEventInit = {}) {
  act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options })))
}
function advance() { act(() => vi.advanceTimersByTime(600)) }

describe('词卡导航与学习闭环', () => {
  it('掌握后自动下一词，关闭卡片后旧计时器不重新打开', () => {
    mountCard()
    click(button('已掌握'))
    expect(useStore.getState().progress.inspect.status).toBe('mastered')
    click(container.querySelector('[aria-label="关闭词卡"]') as HTMLElement)
    advance()
    expect(useStore.getState().selectedWordId).toBeNull()
    expect(container.querySelector('.wordcard')).toBeNull()
  })

  it('掌握后手动选其他词，旧计时器不抢走新选择', () => {
    mountCard()
    click(button('已掌握'))
    act(() => useStore.getState().selectWord('scope'))
    advance()
    expect(useStore.getState().selectedWordId).toBe('scope')
    expect(container.querySelector('h2')?.textContent).toContain('scope')
  })

  it('没有其他操作时，掌握后只走到同词根下一词', () => {
    mountCard()
    click(button('已掌握'))
    advance()
    expect(useStore.getState().selectedWordId).toBe('prospect')
    expect(container.querySelector('h2')?.textContent).toContain('prospect')
  })

  it('快速再次按掌握快捷键不会把同一题计为两次复习', () => {
    mountCard()
    key(document.body, '3')
    key(document.body, '3')
    expect(useStore.getState().progress.inspect.srs?.reps).toBe(1)
    expect(useStore.getState().progress.inspect.srs?.interval).toBe(1)
    advance()
    expect(useStore.getState().selectedWordId).toBe('prospect')
  })

  it('自测先隐藏释义，看答案后评分保存并切到下一题', () => {
    mountCard(true)
    expect(container.querySelector('.def')).toBeNull()
    expect(container.textContent).not.toContain('We inspect the house.')
    click(button('看答案'))
    expect(container.querySelector('.def')?.textContent).toBe('检查')
    click(button('想起来了'))
    expect(useStore.getState().progress.inspect.srs?.interval).toBe(1)
    advance()
    expect(useStore.getState().selectedWordId).not.toBe('inspect')
    expect(container.querySelector('.def')).toBeNull()
  })

  it('按钮保留焦点时数字评分、下一词、Escape仍可用', () => {
    mountCard(true)
    const show = button('看答案')
    click(show)
    key(document.activeElement as HTMLElement, '2')
    expect(useStore.getState().progress.inspect.status).toBe('mastered')
    advance()
    const next = button('下一个 →')
    next.focus()
    key(next, 'ArrowRight')
    expect(useStore.getState().selectedWordId).toBe('scope')
    key(button('看答案'), 'Escape')
    expect(useStore.getState().selectedWordId).toBeNull()
  })

  it('输入框、组合键与长按不会误评分', () => {
    mountCard(true)
    click(button('看答案'))
    const input = document.createElement('input')
    document.body.appendChild(input)
    key(input, '2')
    key(document.body, '2', { ctrlKey: true })
    key(document.body, '2', { repeat: true })
    expect(useStore.getState().progress.inspect).toBeUndefined()
    input.remove()
  })

  it('存储满了时原进度和选择保留，界面显示失败原因', () => {
    mountCard()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
    click(button('已掌握'))
    advance()
    expect(useStore.getState().progress.inspect).toBeUndefined()
    expect(useStore.getState().selectedWordId).toBe('inspect')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('没能保存')
  })

  it('到期复习答完最后一词显示完成，不跳入未背的新词', () => {
    const existing = { inspect: { status: 'mastered' as const } }
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(existing))
    useStore.setState({ progress: existing })
    mountCard(true, true)
    click(button('看答案'))
    click(button('想起来了'))
    advance()
    expect(useStore.getState().selectedWordId).toBe('inspect')
    expect(container.textContent).toContain('本轮到期复习完成了')
    expect(useStore.getState().progress.prospect).toBeUndefined()
  })

  it('忘记的词十分钟内不回到普通学习或复习池', () => {
    const now = Date.now()
    const progress = Object.fromEntries(words.map((word) => [word.id, scheduleReview(undefined, 'forgot', now)]))
    expect(chooseStudyWord(words, progress, { now })).toBeNull()
    expect(chooseStudyWord(words, progress, { now, reviewOnly: true })).toBeNull()
    expect(chooseStudyWord(words, progress, { now: now + 600_000, reviewOnly: true })?.id).toBeTruthy()
  })

  it('全部已掌握且未到复习时间时结束本轮', () => {
    const now = Date.now()
    const progress = Object.fromEntries(words.map((word) => [word.id, scheduleReview(undefined, 'remembered', now)]))
    expect(chooseStudyWord(words, progress, { now })).toBeNull()
  })
})

describe('目录的可用导航', () => {
  it('专注模式点击词根能打开相应单词，不留下空白卡片', () => {
    act(() => root.render(<Sidebar roots={roots} words={words} open onClose={() => {}} studyMode />))
    click([...container.querySelectorAll('.root-head')].find((element) => element.textContent?.includes('scope')) as HTMLElement)
    expect(useStore.getState().selectedWordId).toBe('scope')
    expect(useStore.getState().focusRootId).toBeNull()
  })

  it('词根含义和英文释义可搜索，空结果明确可见', () => {
    act(() => root.render(<Sidebar roots={roots} words={words} open onClose={() => {}} />))
    act(() => useStore.getState().setQuery('观察'))
    expect([...container.querySelectorAll('.word-row')].map((row) => row.textContent?.trim())).toEqual(['scope范围'])
    act(() => useStore.getState().setQuery('carefully'))
    expect(container.querySelector('.word-row')?.textContent).toContain('inspect')
    act(() => useStore.getState().setQuery('不存在的词'))
    expect(container.querySelector('.search-empty')?.textContent).toContain('没有找到')
  })
})
