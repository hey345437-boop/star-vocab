import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { loadCatalog, validateCatalog } from '../src/lib/catalog'
import { buildSceneGraph, endpointKey } from '../src/lib/sceneGraph'
import type { Root, Word, WordLink } from '../src/types'

const read = (name: string) => JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))
const roots: Root[] = read('roots')
const words: Word[] = read('words')
const links: WordLink[] = read('wordlinks')

describe('a usable, validated catalog', () => {
  it('loads every real word and keeps root and word identity separate', () => {
    const data = validateCatalog(roots, words, links)
    expect(data.roots).toHaveLength(72)
    expect(data.words).toHaveLength(432)
    expect(data.words.every(word => word.def_en.trim().length > 0)).toBe(true)
    const graph = buildSceneGraph(data.roots, data.words, data.wordLinks)
    expect(graph.nodes).toHaveLength(504)
    expect(new Set(graph.nodes.map(node => node.id)).size).toBe(504)
    expect(graph.nodeByKey.get('root:scope')?.kind).toBe('root')
    expect(graph.nodeByKey.get('word:scope')?.rawId).toBe('scope')
    const member = graph.links.find(link => link.kind === 'member' && endpointKey(link.target) === 'word:scope')!
    expect(endpointKey(member.source)).toBe('root:scope')
    for (const link of graph.links.filter(link => link.kind === 'rel')) {
      expect(graph.nodeByKey.get(endpointKey(link.source))?.kind).toBe('word')
      expect(graph.nodeByKey.get(endpointKey(link.target))?.kind).toBe('word')
    }
  })
  it('keeps graph mutation out of the source catalog and restores deterministic positions', () => {
    const before = JSON.stringify({ roots, words, links })
    const first = buildSceneGraph(roots, words, links)
    const originalPositions = first.nodes.map(({ id, x, y, z }) => ({ id, x, y, z }))
    const rootEdges = first.orbitEdgesByRoot.get('scope')!
    expect(new Set(rootEdges).size).toBe(rootEdges.length)
    first.nodes[0].x += 100
    first.links[0].source = first.nodes[0]
    const restored = buildSceneGraph(roots, words, links)
    expect(restored.nodes.map(({ id, x, y, z }) => ({ id, x, y, z }))).toEqual(originalPositions)
    expect(JSON.stringify({ roots, words, links })).toBe(before)
  })
  it.each([
    ['duplicate root', () => [[...roots, roots[0]], words, links]],
    ['duplicate word', () => [roots, [...words, words[0]], links]],
    ['empty definition', () => [roots, words.map((word, index) => index ? word : { ...word, def_en: '' }), links]],
    ['empty phonetic', () => [roots, words.map((word, index) => index ? word : { ...word, phonetic: '' }), links]],
    ['empty root', () => [[...roots, { ...roots[0], id: 'empty' }], words, links]],
    ['duplicate spelling', () => [roots, [...words, { ...words[0], id: 'another-id' }], links]],
    ['unknown root', () => [roots, [{ ...words[0], rootId: 'missing' }], []]],
    ['invalid color', () => [[{ ...roots[0], color: 'red' }], words, links]],
    ['unknown relation', () => [roots, words, [{ ...links[0], type: 'wrong' }]]],
    ['missing endpoint', () => [roots, words, [{ ...links[0], a: 'missing' }]]],
    ['self relation', () => [roots, words, [{ ...links[0], b: links[0].a }]]],
    ['duplicate relation', () => [roots, words, [links[0], { ...links[0], a: links[0].b, b: links[0].a }]]],
    ['empty data', () => [[], words, links]],
  ])('rejects %s before passing data to the scene', (_name, values) => {
    const [r, w, l] = values()
    expect(() => validateCatalog(r, w, l)).toThrow()
  })
  it('rejects a failed response and can retry with a correct subdirectory path', async () => {
    const controller = new AbortController()
    const failed = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
    await expect(loadCatalog('/learning/', controller.signal, failed as typeof fetch)).rejects.toThrow('下载')
    const complete = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('roots.json') ? roots : url.endsWith('words.json') ? words : links)))
    const data = await loadCatalog('/learning/', controller.signal, complete as typeof fetch)
    expect(data.words).toHaveLength(432)
    expect(complete.mock.calls.map(([url]) => url)).toEqual(['/learning/data/roots.json', '/learning/data/words.json', '/learning/data/wordlinks.json'])
  })
  it('does not keep a loading request alive after it is canceled', async () => {
    const controller = new AbortController()
    const pending = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true })
    }))
    const result = loadCatalog('./', controller.signal, pending as typeof fetch)
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(pending).toHaveBeenCalledTimes(3)
  })
})
