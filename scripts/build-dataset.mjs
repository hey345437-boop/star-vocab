#!/usr/bin/env node
// 星空背单词 · 数据管线
// 作用：以 public/data/{roots,words}.json + scripts/manual-links.json 为「人工源」，
//   自动产出 public/data/wordlinks.json（词族/反义前缀对等关系自动推断 + 人工关系合并），
//   并可选地联网补全单词音标（dictionaryapi.dev，免费无 key）。
// 用法：
//   node scripts/build-dataset.mjs           # 校验 + 重建关系图
//   node scripts/build-dataset.mjs --fetch   # 额外联网补音标（国内可能需代理）
//
// 扩词工作流：往 public/data/words.json 追加 { id, word, rootId, pos, def_zh, breakdown, example }
//   （phonetic 可留空，--fetch 会补），新词根加进 roots.json（color 可留空，自动配色），
//   然后 `npm run data` —— 关系网自动长出来。不可推断的近义/造句写进 scripts/manual-links.json。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, '..', 'public', 'data')
const CACHE = join(HERE, '.cache')
const MANUAL = join(HERE, 'manual-links.json')
const DO_FETCH = process.argv.includes('--fetch')

const rd = (p) => JSON.parse(readFileSync(p, 'utf8'))
const wr = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + '\n')

const PALETTE = [
  '#7AA2FF', '#FF9E64', '#9ECE6A', '#F7768E', '#BB9AF7', '#2AC3DE', '#E0AF68', '#73DACA',
  '#FF7EB6', '#9D7CD8', '#FFB86C', '#8BE9FD', '#50FA7B', '#FF92DF', '#BD93F9', '#FF6E6E',
  '#5AC8FA', '#06D6A0', '#7DCFFF', '#4FD6BE', '#FFD166', '#C3A6FF', '#FF8FAB', '#8CE99A',
  '#63E6BE', '#FFA94D', '#74C0FC', '#F783AC', '#B197FC', '#FFC078', '#66D9E8', '#A9E34B',
]

// ---------- 读入人工源 ----------
const roots = rd(join(DATA, 'roots.json'))
const words = rd(join(DATA, 'words.json'))

// ---------- 校验源 ----------
const rid = new Set(roots.map((r) => r.id))
const wid = new Set()
const problems = []
for (const w of words) {
  if (wid.has(w.id)) problems.push('重复 word id: ' + w.id)
  wid.add(w.id)
  if (!rid.has(w.rootId)) problems.push(`${w.id} 指向不存在的词根 ${w.rootId}`)
  for (const f of ['word', 'rootId', 'pos', 'def_zh', 'breakdown', 'example']) {
    if (!w[f]) problems.push(`${w.id} 缺字段 ${f}`)
  }
}
if (problems.length) {
  console.error('✗ 源数据有问题：\n' + problems.join('\n'))
  process.exit(1)
}

// ---------- 自动补全：词根配色 ----------
let recolored = 0
roots.forEach((r, i) => {
  if (!r.color) {
    r.color = PALETTE[i % PALETTE.length]
    recolored++
  }
})
if (recolored) wr(join(DATA, 'roots.json'), roots)

// ---------- 关系图：人工 + 自动推断 ----------
// 引导 manual-links.json（首次从现有 wordlinks.json 无损搬过来）
let manual = []
if (existsSync(MANUAL)) manual = rd(MANUAL)
else if (existsSync(join(DATA, 'wordlinks.json'))) {
  manual = rd(join(DATA, 'wordlinks.json'))
  wr(MANUAL, manual)
  console.log(`↳ 已从现有 wordlinks.json 引导出 manual-links.json（${manual.length} 条人工关系）`)
}

const keyOf = (a, b) => [a, b].sort().join('|')
const have = new Set(manual.map((l) => keyOf(l.a, l.b)))
const auto = []
const add = (a, b, type, note) => {
  if (a === b) return
  const k = keyOf(a, b)
  if (have.has(k)) return
  have.add(k)
  auto.push({ a, b, type, note })
}

const byRoot = {}
for (const w of words) (byRoot[w.rootId] ||= []).push(w)

// 已知前缀（最长优先），用于反义前缀对判断
const PREFIXES = ['intro', 'extro', 'trans', 'super', 'inter', 'contra', 'under', 'over', 'anti', 'auto', 'pro', 'pre', 'per', 'con', 'com', 'dis', 'sub', 'mono', 're', 'de', 'ex', 'in', 'im', 'ob', 'ad', 'ab', 'un', 'bi']
const prefixOf = (w) => PREFIXES.find((p) => w.toLowerCase().startsWith(p) && w.length > p.length + 2) || null
const ANTONYM_PAIRS = [['in', 'ex'], ['im', 'ex'], ['pro', 're'], ['pro', 'de'], ['con', 'de'], ['sub', 'super'], ['intro', 'extro'], ['under', 'over'], ['im', 'de'], ['in', 'de']]

const commonSuffix = (a, b) => {
  let i = a.length - 1, j = b.length - 1, n = 0
  while (i >= 0 && j >= 0 && a[i] === b[j]) { i--; j--; n++ }
  return a.slice(a.length - n)
}

// 1) 同根 · 词尾押韵词族 → colloquial（链式，避免全连）
for (const r in byRoot) {
  const ws = byRoot[r].slice().sort((a, b) => a.word.slice(-5).localeCompare(b.word.slice(-5)))
  for (let i = 0; i < ws.length - 1; i++) {
    const s = commonSuffix(ws[i].word.toLowerCase(), ws[i + 1].word.toLowerCase())
    if (s.length >= 4) add(ws[i].id, ws[i + 1].id, 'colloquial', `同根词族：-${s} 押韵`)
  }
}
// 2) 同根 · 反义前缀对 → antonym
for (const r in byRoot) {
  const ws = byRoot[r]
  for (let i = 0; i < ws.length; i++)
    for (let j = i + 1; j < ws.length; j++) {
      const pi = prefixOf(ws[i].word), pj = prefixOf(ws[j].word)
      if (pi && pj && ANTONYM_PAIRS.some(([x, y]) => (pi === x && pj === y) || (pi === y && pj === x)))
        add(ws[i].id, ws[j].id, 'antonym', `反义：前缀 ${pi}- ↔ ${pj}-（同根 ${r}）`)
    }
}
// 3) 跨根 · 经典前缀家族 → colloquial（tele- / micro- 这类好玩的）
for (const fam of ['tele', 'micro', 'mega', 'auto', 'anti', 'mono', 'bio', 'geo', 'peri']) {
  const ws = words.filter((w) => w.word.toLowerCase().startsWith(fam) && w.word.length > fam.length + 2)
  for (let i = 0; i < ws.length - 1; i++) add(ws[i].id, ws[i + 1].id, 'colloquial', `${fam}- 家族`)
}

const all = [...manual, ...auto]
// 终检：无悬空引用、无重复
const lerr = []
const lseen = new Set()
for (const l of all) {
  if (!wid.has(l.a)) lerr.push('关系指向不存在的词: ' + l.a)
  if (!wid.has(l.b)) lerr.push('关系指向不存在的词: ' + l.b)
  const k = keyOf(l.a, l.b)
  if (lseen.has(k)) lerr.push('重复关系: ' + k)
  lseen.add(k)
}
if (lerr.length) {
  console.error('✗ 关系数据有问题：\n' + lerr.join('\n'))
  process.exit(1)
}
wr(join(DATA, 'wordlinks.json'), all)

console.log(`✓ roots ${roots.length} · words ${words.length} · links ${all.length}  (人工 ${manual.length} + 自动 ${auto.length})`)
if (recolored) console.log(`  ↳ 自动给 ${recolored} 个词根配了色`)

// ---------- 可选：联网补音标 ----------
if (DO_FETCH) {
  await enrichPhonetics()
}

async function enrichPhonetics() {
  if (!existsSync(CACHE)) mkdirSync(CACHE)
  const cacheFile = join(CACHE, 'phonetics.json')
  const cache = existsSync(cacheFile) ? rd(cacheFile) : {}
  const todo = words.filter((w) => !w.phonetic)
  console.log(`↻ 联网补音标：${todo.length} 个待补…`)
  let filled = 0, miss = 0
  for (const w of todo) {
    let p = cache[w.word]
    if (p === undefined) {
      p = await fetchPhonetic(w.word)
      cache[w.word] = p || null
      writeFileSync(cacheFile, JSON.stringify(cache, null, 0))
      await new Promise((r) => setTimeout(r, 120))
    }
    if (p) { w.phonetic = p; filled++ } else miss++
  }
  if (filled) wr(join(DATA, 'words.json'), words)
  console.log(`✓ 补到 ${filled} 个，${miss} 个 API 无结果（可手填）`)
}

async function fetchPhonetic(word) {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
    if (!res.ok) return null
    const j = await res.json()
    const txt = j?.[0]?.phonetic || j?.[0]?.phonetics?.find((x) => x.text)?.text
    return txt || null
  } catch {
    return null
  }
}
