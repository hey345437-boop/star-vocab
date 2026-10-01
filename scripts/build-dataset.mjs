#!/usr/bin/env node
// 词库生成：只根据词形生成助记关系；近义、反义和例句必须人工确认。
// npm run data 校验并生成，npm run data:enrich 额外补齐缺失音标。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, '..', 'public', 'data')
const CACHE = join(HERE, '.cache')
const MANUAL = join(HERE, 'manual-links.json')
const PALETTE = [
  '#7AA2FF', '#FF9E64', '#9ECE6A', '#F7768E', '#BB9AF7', '#2AC3DE', '#E0AF68', '#73DACA',
  '#FF7EB6', '#9D7CD8', '#FFB86C', '#8BE9FD', '#50FA7B', '#FF92DF', '#BD93F9', '#FF6E6E',
  '#5AC8FA', '#06D6A0', '#7DCFFF', '#4FD6BE', '#FFD166', '#C3A6FF', '#FF8FAB', '#8CE99A',
  '#63E6BE', '#FFA94D', '#74C0FC', '#F783AC', '#B197FC', '#FFC078', '#66D9E8', '#A9E34B',
]
const TYPES = new Set(['synonym', 'antonym', 'sentence', 'colloquial'])
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype'])
const rd = (path) => JSON.parse(readFileSync(path, 'utf8'))
const wr = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value) => typeof value === 'string' && Boolean(value.trim())
const isId = (value) => isText(value) && value === value.trim() && !FORBIDDEN_IDS.has(value)
const pairKey = (a, b) => JSON.stringify([a, b].sort())
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0

export function validateSources(roots, words, { requirePhonetics = false, requireColors = false } = {}) {
  const problems = []
  if (!Array.isArray(roots) || !roots.length) problems.push('词根必须是非空数组')
  if (!Array.isArray(words) || !words.length) problems.push('单词必须是非空数组')
  if (problems.length) return problems
  const rootIds = new Set()
  for (const root of roots) {
    if (!isRecord(root)) { problems.push('词根条目必须是对象'); continue }
    if (!isId(root.id)) problems.push('词根 ID 不正确: ' + String(root.id))
    if (rootIds.has(root.id)) problems.push('重复 root id: ' + root.id)
    rootIds.add(root.id)
    for (const field of ['root', 'meaning_en', 'meaning_zh', 'origin']) {
      if (!isText(root[field])) problems.push(`${root.id} 缺词根字段 ${field}`)
    }
    if ((requireColors || root.color) && !/^#[0-9a-f]{6}$/i.test(root.color)) {
      problems.push(`${root.id} 词根颜色须为六位十六进制色值`)
    }
  }
  const wordIds = new Set()
  const spellings = new Set()
  const members = new Set()
  for (const word of words) {
    if (!isRecord(word)) { problems.push('单词条目必须是对象'); continue }
    if (!isId(word.id)) problems.push('单词 ID 不正确: ' + String(word.id))
    if (wordIds.has(word.id)) problems.push('重复 word id: ' + word.id)
    wordIds.add(word.id)
    if (!rootIds.has(word.rootId)) problems.push(`${word.id} 指向不存在的词根 ${word.rootId}`)
    members.add(word.rootId)
    for (const field of ['word', 'rootId', 'pos', 'def_zh', 'def_en', 'breakdown', 'example']) {
      if (!isText(word[field])) problems.push(`${word.id} 缺字段 ${field}`)
    }
    if (requirePhonetics && !isText(word.phonetic)) problems.push(`${word.id} 缺字段 phonetic`)
    if (word.phonetic !== undefined && typeof word.phonetic !== 'string') problems.push(`${word.id} 音标须为文字`)
    if (typeof word.word === 'string') {
      const spelling = word.word.trim().toLowerCase()
      if (spellings.has(spelling)) problems.push('重复单词拼写: ' + word.word)
      spellings.add(spelling)
    }
  }
  for (const id of rootIds) if (!members.has(id)) problems.push('没有单词的词根: ' + id)
  return problems
}

export function validateLinks(links, wordIds) {
  if (!Array.isArray(links)) return ['关系必须是数组']
  const problems = []
  const pairs = new Set()
  for (const link of links) {
    if (!isRecord(link)) { problems.push('关系条目必须是对象'); continue }
    if (!wordIds.has(link.a)) problems.push('关系指向不存在的词: ' + String(link.a))
    if (!wordIds.has(link.b)) problems.push('关系指向不存在的词: ' + String(link.b))
    if (link.a === link.b) problems.push('单词不能与自身建立关系: ' + String(link.a))
    if (!TYPES.has(link.type)) problems.push('未知关系类型: ' + String(link.type))
    if (!isText(link.note)) problems.push(`${link.a} / ${link.b} 缺少关系说明`)
    const key = pairKey(link.a, link.b)
    if (pairs.has(key)) problems.push('重复关系: ' + key)
    pairs.add(key)
  }
  return problems
}

export function generateWordLinks(roots, words, manual) {
  const wordIds = new Set(Array.isArray(words) ? words.filter(isRecord).map((word) => word.id) : [])
  const problems = [
    ...validateSources(roots, words),
    ...validateLinks(manual, wordIds),
  ]
  if (problems.length) throw new Error(problems.join('\n'))
  const links = manual.map((link) => ({ ...link }))
  const pairs = new Set(links.map((link) => pairKey(link.a, link.b)))
  const add = (a, b, note) => {
    const key = pairKey(a, b)
    if (a === b || pairs.has(key)) return
    pairs.add(key)
    links.push({ a, b, type: 'colloquial', note })
  }
  const byRoot = new Map()
  for (const word of words) {
    const group = byRoot.get(word.rootId) ?? []
    group.push(word)
    byRoot.set(word.rootId, group)
  }
  const commonSuffix = (a, b) => {
    let size = 0
    while (size < a.length && size < b.length && a[a.length - 1 - size] === b[b.length - 1 - size]) size++
    return size ? a.slice(-size) : ''
  }
  for (const group of byRoot.values()) {
    const sorted = group.slice().sort((a, b) => compareText(a.word.toLowerCase().slice(-5), b.word.toLowerCase().slice(-5)) || compareText(a.id, b.id))
    for (let i = 0; i < sorted.length - 1; i++) {
      const suffix = commonSuffix(sorted[i].word.toLowerCase(), sorted[i + 1].word.toLowerCase())
      if (suffix.length >= 4) add(sorted[i].id, sorted[i + 1].id, `词形助记：同根单词共有词尾 -${suffix}；读音请以音标为准。`)
    }
  }
  for (const family of ['tele', 'micro', 'mega', 'auto', 'anti', 'mono', 'bio', 'geo', 'peri']) {
    const group = words.filter((word) => word.word.toLowerCase().startsWith(family) && word.word.length > family.length + 2)
    for (let i = 0; i < group.length - 1; i++) {
      add(group[i].id, group[i + 1].id, `词形助记：共有开头 ${family}-；不表示近义或反义。`)
    }
  }
  return links
}

async function main() {
  const roots = rd(join(DATA, 'roots.json'))
  const words = rd(join(DATA, 'words.json'))
  // 缺少人工文件时明确报错，不把旧的自动推断冒充人工确认。
  if (!existsSync(MANUAL)) throw new Error('缺少 scripts/manual-links.json，请从项目备份恢复人工关系。')
  const manual = rd(MANUAL)
  const links = generateWordLinks(roots, words, manual)
  let recolored = 0
  roots.forEach((root, index) => {
    if (!root.color) { root.color = PALETTE[index % PALETTE.length]; recolored++ }
  })
  const phoneticsAdded = process.argv.includes('--fetch') ? await enrichPhonetics(words) : 0
  const problems = [
    ...validateSources(roots, words, { requireColors: true }),
    ...validateLinks(links, new Set(words.map((word) => word.id))),
  ]
  if (problems.length) throw new Error(problems.join('\n'))
  if (recolored) wr(join(DATA, 'roots.json'), roots)
  if (phoneticsAdded) wr(join(DATA, 'words.json'), words)
  wr(join(DATA, 'wordlinks.json'), links)
  console.log(`✓ roots ${roots.length} · words ${words.length} · links ${links.length}  (人工 ${manual.length} + 词形助记 ${links.length - manual.length})`)
  if (recolored) console.log(`  自动为 ${recolored} 个词根配色`)
}

async function enrichPhonetics(words) {
  if (!existsSync(CACHE)) mkdirSync(CACHE)
  const cacheFile = join(CACHE, 'phonetics.json')
  const cache = existsSync(cacheFile) ? rd(cacheFile) : {}
  const todo = words.filter((word) => !word.phonetic)
  console.log(`联网补音标：${todo.length} 个待补`)
  let filled = 0
  for (const word of todo) {
    let phonetic = cache[word.word]
    if (phonetic === undefined) {
      phonetic = await fetchPhonetic(word.word)
      cache[word.word] = phonetic || null
      wr(cacheFile, cache)
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    if (phonetic) { word.phonetic = phonetic; filled++ }
  }
  console.log(`补到 ${filled} 个音标，${todo.length - filled} 个无词典结果，需手工补齐`)
  return filled
}

async function fetchPhonetic(word) {
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
    if (!response.ok) return null
    const entries = await response.json()
    return entries?.[0]?.phonetic || entries?.[0]?.phonetics?.find((entry) => entry.text)?.text || null
  } catch { return null }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error('✗ 数据生成失败：\n' + error.message); process.exitCode = 1 })
}
