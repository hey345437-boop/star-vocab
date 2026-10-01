// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeNodeObject, setNodeState } from '../src/lib/threeNode'
import { useStore } from '../src/store/useStore'
import type { GraphNode, Root, Word } from '../src/types'

// Drawing textures needs a canvas, but these regressions don't need a GPU.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {}, translate() {}, fillText() {},
    measureText: (text: string) => ({ width: text.length * 45 }),
  }) as unknown as CanvasRenderingContext2D)
})

const words: Word[] = JSON.parse(readFileSync(resolve('public/data/words.json'), 'utf8'))
const roots: Root[] = JSON.parse(readFileSync(resolve('public/data/roots.json'), 'utf8'))
const rootById = new Map(roots.map(root => [root.id, root]))
const wordNode = (word: Word): GraphNode & { rawId: string } => ({
  id: `word:${word.id}`, rawId: word.id, kind: 'word', label: word.word,
  rootId: word.rootId, color: rootById.get(word.rootId)!.color, val: 2,
})
const core = (object: THREE.Object3D) => object.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>

describe('the readable original star map appearance', () => {
  it('shows every word label and a bright star in the overview without hovering', () => {
    for (const root of roots) {
      const object = makeNodeObject({
        id: `root:${root.id}`, rawId: root.id, kind: 'root', label: root.root,
        sub: root.meaning_zh, color: root.color, rootId: root.id, val: 8,
      } as GraphNode & { rawId: string })
      const label = object.userData.node.labelSprite
      expect(label.visible, root.id).toBe(true)
      expect(label.scale.y, root.id).toBeGreaterThan(0)
      expect(label.scale.y, root.id).toBeLessThanOrEqual(4)
    }
    for (const word of words) {
      const object = makeNodeObject(wordNode(word))
      const label = object.userData.node.labelSprite
      expect(label.visible, word.id).toBe(true)
      expect(label.scale.y, word.id).toBeGreaterThan(0)
      expect(label.scale.y, word.id).toBeLessThanOrEqual(3.6)
      expect(core(object).material.opacity, word.id).toBeGreaterThan(0.75)
      setNodeState(object, { explore: true, mastered: false, selected: false })
      setNodeState(object, { explore: false, mastered: false, selected: false })
      expect(label.visible, `${word.id} after returning to overview`).toBe(true)
      expect(core(object).material.opacity, word.id).toBeGreaterThan(0.75)
    }
  })

  it('keeps selection and mastery visible while an unrelated word is subdued', () => {
    const object = makeNodeObject(wordNode(words[0]))
    const brightness = (state: Parameters<typeof setNodeState>[1]) => {
      setNodeState(object, state)
      return core(object).material.opacity
    }
    const overview = brightness({ explore: false, mastered: false, selected: false })
    const unrelated = brightness({ explore: true, mastered: false, selected: false })
    const selected = brightness({ explore: true, mastered: false, selected: true })
    const mastered = brightness({ explore: false, mastered: true, selected: false })
    expect(unrelated).toBeLessThan(overview)
    expect(selected).toBeGreaterThan(overview)
    expect(mastered).toBeGreaterThan(overview)
    expect(object.userData.node.labelSprite.visible).toBe(true)
  })

  it('keeps typed IDs separate from the original visual identity and avoids glow click targets', () => {
    const typed = wordNode(words.find(word => word.id === 'scope')!)
    const modern = makeNodeObject(typed)
    const { rawId, ...legacy } = typed
    const original = makeNodeObject({ ...legacy, id: rawId })
    expect(modern.userData.node.onColor.equals(original.userData.node.onColor)).toBe(true)
    modern.updateMatrixWorld(true)
    const centerRay = new THREE.Raycaster(new THREE.Vector3(0, 0, 100), new THREE.Vector3(0, 0, -1))
    const nearRay = new THREE.Raycaster(new THREE.Vector3(8, 0, 100), new THREE.Vector3(0, 0, -1))
    expect(centerRay.intersectObject(modern, true).length).toBeGreaterThan(0)
    expect(nearRay.intersectObject(modern, true)).toHaveLength(0)
  })

  it('opens with the original glow enabled', () => {
    expect(useStore.getState().bloom).toBe(true)
  })
})
