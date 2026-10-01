import type { RelType, Root, Word, WordLink } from '../types'

export interface Catalog { roots: Root[]; words: Word[]; wordLinks: WordLink[] }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function id(value: unknown): value is string { return text(value) && value === value.trim() && !['__proto__', 'constructor', 'prototype'].includes(value) }

export function validateCatalog(rootsValue: unknown, wordsValue: unknown, linksValue: unknown): Catalog {
  if (!Array.isArray(rootsValue) || !rootsValue.length || !Array.isArray(wordsValue) || !wordsValue.length || !Array.isArray(linksValue)) {
    throw new Error('词库文件不完整，请重新加载。')
  }
  const rootIds = new Set<string>()
  for (const root of rootsValue) {
    if (!record(root) || !id(root.id) || rootIds.has(root.id) ||
      !['root', 'meaning_en', 'meaning_zh', 'origin'].every(key => text(root[key])) ||
      typeof root.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(root.color)) throw new Error('词根数据有误，请重新加载。')
    rootIds.add(root.id)
  }
  const wordIds = new Set<string>()
  const spellings = new Set<string>()
  const usedRoots = new Set<string>()
  for (const word of wordsValue) {
    if (!record(word) || !id(word.id) || wordIds.has(word.id) || !text(word.rootId) || !rootIds.has(word.rootId) ||
      !['word', 'pos', 'def_zh', 'breakdown', 'example'].every(key => text(word[key])) ||
      !text(word.phonetic) || !text(word.def_en)) throw new Error('单词数据有误，请重新加载。')
    const spelling = (word.word as string).trim().toLowerCase()
    if (spellings.has(spelling)) throw new Error('词库中有重复单词，请重新加载。')
    spellings.add(spelling)
    usedRoots.add(word.rootId)
    wordIds.add(word.id)
  }
  if ([...rootIds].some(rootId => !usedRoots.has(rootId))) throw new Error('词根缺少对应单词，请重新加载。')
  const types: RelType[] = ['synonym', 'antonym', 'sentence', 'colloquial']
  const pairs = new Set<string>()
  for (const link of linksValue) {
    if (!record(link) || !text(link.a) || !text(link.b) || !wordIds.has(link.a) || !wordIds.has(link.b) ||
      link.a === link.b || !types.includes(link.type as RelType) || !text(link.note)) throw new Error('单词关系数据有误，请重新加载。')
    const pair = [link.a, link.b].sort().join('|')
    if (pairs.has(pair)) throw new Error('单词关系重复，请重新加载。')
    pairs.add(pair)
  }
  return { roots: rootsValue as Root[], words: wordsValue as Word[], wordLinks: linksValue as WordLink[] }
}

export async function loadCatalog(base: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Catalog> {
  const values = await Promise.all(['roots', 'words', 'wordlinks'].map(async file => {
    const response = await fetcher(`${base}data/${file}.json`, { signal })
    if (!response.ok) throw new Error('词库暂时无法下载，请检查网络后重试。')
    return response.json() as Promise<unknown>
  }))
  return validateCatalog(values[0], values[1], values[2])
}
