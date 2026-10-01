#!/usr/bin/env node
// 学习内容回归：检查真实词库缺漏，并保护关系生成的教学含义。
// 不连接网络、不写词库，也不读取个人学习记录。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { generateWordLinks, validateLinks, validateSources } from './build-dataset.mjs'

const base = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => JSON.parse(readFileSync(join(base, path), 'utf8'))
const roots = read('public/data/roots.json')
const words = read('public/data/words.json')
const links = read('public/data/wordlinks.json')
const manual = read('scripts/manual-links.json')
const strictOptions = { requirePhonetics: true, requireColors: true }
const problems = [
  ...validateSources(roots, words, strictOptions),
  ...validateLinks(links, new Set(words.map((word) => word.id))),
]
assert.deepEqual(problems, [], '真实词库必须完整，关系不得有悬空引用、重复或未知类型')
assert.ok(words.every((word) => /[a-z]/i.test(word.def_en)), '每张词卡都应有可显示的英文释义')

const before = JSON.stringify({ roots, words, manual })
const regenerated = generateWordLinks(roots, words, manual)
assert.deepEqual(regenerated, links, '人工关系修改后必须重新生成词库，生成物不能漂移')
assert.equal(JSON.stringify(generateWordLinks(roots, words, manual)), JSON.stringify(regenerated), '同一数据应生成完全相同的关系')
assert.equal(JSON.stringify({ roots, words, manual }), before, '生成器不能修改人工源数据')

const key = (a, b) => JSON.stringify([a, b].sort())
const manualPairs = new Map(manual.map((link) => [key(link.a, link.b), link]))
for (const link of regenerated.filter((link) => link.type !== 'colloquial')) {
  assert.deepEqual(link, manualPairs.get(key(link.a, link.b)), '含义关系必须有人工确认，不能由拼写自动推断')
}
for (const link of regenerated.filter((link) => !manualPairs.has(key(link.a, link.b)))) {
  assert.equal(link.type, 'colloquial', '自动连线只说明词形')
  assert.equal(/押韵|反义|近义/.test(link.note.replace('不表示近义或反义。', '')), false, '不能把拼写说成发音或语义事实')
}
const pair = (a, b) => links.find((link) => key(link.a, link.b) === key(a, b))
for (const [a, b] of [['instruct', 'destruction'], ['provide', 'revise'], ['infinite', 'define'], ['conscious', 'subconscious']]) {
  assert.notEqual(pair(a, b)?.type, 'antonym', `${a}/${b} 不能作为严格反义关系`)
}
for (const [a, b] of [['inspire', 'aspire'], ['epidemic', 'pandemic'], ['empathy', 'sympathy']]) {
  assert.notEqual(pair(a, b)?.type, 'synonym', `${a}/${b} 应解释区别，不能直接当同义词`)
}
// scope 的两个身份都合法，图必须区分它们，而非改掉已保存的学习 ID。
assert.ok(roots.some((root) => root.id === 'scope') && words.some((word) => word.id === 'scope'), '保留原 scope 的两个数据身份')

// 小词库演练坏数据拒绝和人工含义优先，避免只检查当前统计数量。
const root = { id: 'sample', root: 'sample', meaning_en: 'sample', meaning_zh: '示例', origin: 'editorial fixture', color: '#123456' }
const word = (id) => ({ id, word: id, rootId: root.id, pos: 'n.', def_zh: '示例', def_en: 'a fixture used for a check', breakdown: '示例拆解', example: 'This is an example.', phonetic: '/test/' })
const fixtureWords = ['instruct', 'destruction', 'provide', 'revise', 'conscious', 'subconscious'].map(word)
assert.ok(generateWordLinks([root], fixtureWords, []).every((link) => link.type === 'colloquial'), '同根+相反前缀不会自动产生反义词')
const confirmed = { a: 'conscious', b: 'subconscious', type: 'sentence', note: 'Conscious thought can be influenced by the subconscious.' }
assert.deepEqual(generateWordLinks([root], fixtureWords, [confirmed]).find((link) => key(link.a, link.b) === key(confirmed.a, confirmed.b)), confirmed, '人工关系不被自动词形覆盖')
const expectBadSources = (candidateRoots, candidateWords, label) => assert.ok(validateSources(candidateRoots, candidateWords, strictOptions).length > 0, label)
expectBadSources([root, { ...root }], fixtureWords, '重复词根应被拒绝')
expectBadSources([{ ...root, color: 'blue' }], fixtureWords, '不合法的颜色应被拒绝')
expectBadSources([root], [{ ...fixtureWords[0], def_en: ' ' }], '空英文释义应被拒绝')
expectBadSources([root], [{ ...fixtureWords[0], phonetic: '' }], '学习词库缺音标应被拒绝')
expectBadSources([root], [{ ...fixtureWords[0], rootId: 'missing-root' }], '悬空词根应被拒绝')
expectBadSources([root], [fixtureWords[0], { ...fixtureWords[0] }], '重复词 ID 应被拒绝')
expectBadSources([root], [fixtureWords[0], { ...fixtureWords[0], id: 'other-id' }], '重复单词拼写应被拒绝')
expectBadSources([root], [{ ...fixtureWords[0], id: '__proto__' }], '特殊对象键不能作为学习 ID')
expectBadSources([root, { ...root, id: 'empty' }], fixtureWords, '空词根应被拒绝')
const ids = new Set(fixtureWords.map((entry) => entry.id))
for (const bad of [
  { ...confirmed, a: 'missing-word' },
  { ...confirmed, b: confirmed.a },
  { ...confirmed, type: 'unknown' },
  { ...confirmed, note: '' },
]) assert.ok(validateLinks([bad], ids).length > 0, '不完整关系应被拒绝')
assert.ok(validateLinks([confirmed, { ...confirmed, a: confirmed.b, b: confirmed.a }], ids).length > 0, '反向重复关系应被拒绝')
assert.throws(() => generateWordLinks(null, fixtureWords, []), /词根/, '损坏数组应报告数据问题')
assert.throws(() => generateWordLinks([root], null, []), /单词/, '损坏数组应报告数据问题')

console.log(`学习内容检查通过：${roots.length} 个词根、${words.length} 张完整词卡、${links.length} 条已校验关系；坏数据和错误语义回归通过。`)
