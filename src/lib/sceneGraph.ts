import type { GraphLink, GraphNode, Root, Word, WordLink } from '../types'
import { hexA } from './render'
import { REL } from './rel'

export interface SceneNode extends GraphNode {
  rawId: string
  deg: number
  x: number
  y: number
  z: number
  fx?: number
  fy?: number
  fz?: number
}

export interface SceneLink extends Omit<GraphLink, 'source' | 'target'> {
  source: string | SceneNode
  target: string | SceneNode
  baseHex: string
  baseAlpha: number
  phase: number
}

export function nodeKey(kind: 'root' | 'word', rawId: string) {
  return `${kind}:${rawId}`
}

export function endpointKey(endpoint: string | SceneNode) {
  return typeof endpoint === 'string' ? endpoint : endpoint.id
}

export function hashId(id: string) {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  // Mix neighboring IDs too; sequential background stars should not form stripes.
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
  return (hash ^ (hash >>> 16)) >>> 0
}

export function randomFor(id: string) {
  return (hashId(id) % 10000) / 10000
}

// The graph owns mutable force-graph records; catalog objects remain untouched.
// Typed keys are separate from raw word IDs used by saved learning progress.
export function buildSceneGraph(roots: Root[], words: Word[], wordLinks: WordLink[]) {
  const nodes: SceneNode[] = []
  const links: SceneLink[] = []
  const nodeByKey = new Map<string, SceneNode>()
  const rootById = new Map(roots.map((root) => [root.id, root]))
  const wordNodesByRoot = new Map<string, SceneNode[]>()
  const incidentRelations = new Map<string, SceneLink[]>()
  const orbitEdgesByRoot = new Map<string, SceneLink[]>()
  const sortedRoots = [...roots].sort((a, b) => a.id.localeCompare(b.id))

  for (const [index, root] of sortedRoots.entries()) {
    // Deterministic starting positions prevent a crowded, moving first screen.
    const y = 1 - (2 * (index + 0.5)) / sortedRoots.length
    const angle = index * Math.PI * (3 - Math.sqrt(5))
    const radius = 280 + randomFor(root.id) * 70
    const side = Math.sqrt(1 - y * y)
    const node: SceneNode = {
      id: nodeKey('root', root.id), rawId: root.id, kind: 'root',
      label: root.root, sub: root.meaning_zh, color: root.color,
      rootId: root.id, val: 8, deg: 0,
      x: Math.cos(angle) * side * radius,
      y: y * radius,
      z: Math.sin(angle) * side * radius,
    }
    nodes.push(node)
    nodeByKey.set(node.id, node)
    wordNodesByRoot.set(root.id, [])
    orbitEdgesByRoot.set(root.id, [])
  }

  for (const word of [...words].sort((a, b) => a.id.localeCompare(b.id))) {
    const root = nodeByKey.get(nodeKey('root', word.rootId))
    if (!root) throw new Error(`单词 ${word.id} 的词根不存在`)
    const slot = wordNodesByRoot.get(word.rootId)!.length
    const angle = slot * Math.PI * (3 - Math.sqrt(5)) + randomFor(word.rootId) * Math.PI * 2
    const tilt = randomFor(`${word.id}:tilt`) * Math.PI * 2
    const radius = 22 + randomFor(`${word.id}:radius`) * 18
    const color = rootById.get(word.rootId)!.color
    const node: SceneNode = {
      id: nodeKey('word', word.id), rawId: word.id, kind: 'word',
      label: word.word, sub: word.phonetic, color, rootId: word.rootId,
      val: 2, deg: 0,
      x: root.x + Math.cos(angle) * radius,
      y: root.y + Math.sin(angle) * Math.cos(tilt) * radius,
      z: root.z + Math.sin(angle) * Math.sin(tilt) * radius,
    }
    if (nodeByKey.has(node.id)) throw new Error(`单词 ${word.id} 重复`)
    nodes.push(node)
    nodeByKey.set(node.id, node)
    wordNodesByRoot.get(word.rootId)!.push(node)
    links.push({
      source: root.id, target: node.id, color: hexA(color, 0.09),
      kind: 'member', width: 0, baseHex: color, baseAlpha: 0.09, phase: 0,
    })
  }

  for (const [index, relation] of wordLinks.entries()) {
    const source = nodeKey('word', relation.a)
    const target = nodeKey('word', relation.b)
    if (!nodeByKey.has(source) || !nodeByKey.has(target)) throw new Error('词间关系指向不存在的单词')
    const color = REL[relation.type].color
    const link: SceneLink = {
      source, target, color: hexA(color, 0.3), kind: 'rel',
      relType: relation.type, note: relation.note, width: 0,
      baseHex: color, baseAlpha: 0.3, phase: index * 2.399,
    }
    links.push(link)
    for (const key of [source, target]) {
      const incident = incidentRelations.get(key) ?? []
      incident.push(link)
      incidentRelations.set(key, incident)
    }
  }

  for (const link of links) {
    const a = nodeByKey.get(endpointKey(link.source))!
    const b = nodeByKey.get(endpointKey(link.target))!
    a.deg++
    b.deg++
    // Each affected root sees an edge only once, including relations within it.
    const rootsWithMovingWords = new Set([a, b].filter((node) => node.kind === 'word').map((node) => node.rootId))
    for (const rootId of rootsWithMovingWords) orbitEdgesByRoot.get(rootId)!.push(link)
  }

  return { nodes, links, nodeByKey, wordNodesByRoot, incidentRelations, orbitEdgesByRoot }
}
