import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { overviewPose } from '../src/lib/sceneCamera'
import { buildSceneGraph } from '../src/lib/sceneGraph'
import type { Root, Word, WordLink } from '../src/types'

const read = (name: string) => JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))
const roots: Root[] = read('roots')
const words: Word[] = read('words')
const links: WordLink[] = read('wordlinks')

function movedCloud() {
  const graph = buildSceneGraph(roots, words, links)
  // Represent a completed force layout, including a translated center and a much larger spread.
  for (const node of graph.nodes) {
    node.x = node.x * 26 + 10000
    node.y = node.y * 19 - 8000
    node.z = node.z * 33 + 4000
  }
  return graph.nodes
}

function expectAllStarsInView(nodes: ReturnType<typeof movedCloud>, width: number, height: number) {
  const pose = overviewPose(nodes, width, height)
  const target = new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z)
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000000)
  const matrix = new THREE.Matrix4()
  const frustum = new THREE.Frustum()
  for (const pitch of [-0.4, 0, 0.4]) {
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      camera.position.set(
        target.x + pose.distance * Math.cos(pitch) * Math.sin(yaw),
        target.y + pose.distance * Math.sin(pitch),
        target.z + pose.distance * Math.cos(pitch) * Math.cos(yaw),
      )
      camera.lookAt(target)
      camera.updateMatrixWorld(true)
      frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      for (const node of nodes) {
        const point = new THREE.Vector3(node.x, node.y, node.z)
        expect(frustum.containsPoint(point), `${node.id}, yaw=${yaw}, pitch=${pitch}`).toBe(true)
        // Include the original root's outer glow (diameter 52), not just its center point.
        for (const plane of frustum.planes) {
          expect(plane.distanceToPoint(point), `${node.id} glow, yaw=${yaw}, pitch=${pitch}`).toBeGreaterThanOrEqual(26 - 1e-7)
        }
      }
    }
  }
}

describe('a camera overview that fits the actual star cloud', () => {
  it.each([
    ['desktop', 1440, 900],
    ['compact desktop', 1280, 800],
    ['narrow phone', 390, 844],
    ['wide desktop', 2560, 900],
  ])('keeps all real stars and glows visible through overview rotations on %s', (_name, width, height) => {
    expectAllStarsInView(movedCloud(), width, height)
  })

  it('fits the first frame even when every rendered object still has an identity world matrix', () => {
    const nodes = movedCloud()
    for (const node of nodes) {
      // These represent freshly created node meshes before the renderer's first matrix update.
      const object = new THREE.Group()
      expect(object.matrixWorld.equals(new THREE.Matrix4())).toBe(true)
      Object.defineProperty(node, '__threeObj', {
        get() { throw new Error('A first-frame overview must not read unrendered geometry or matrices') },
      })
    }
    expectAllStarsInView(nodes, 1440, 900)
  })

  it('uses updated layout coordinates after nodes move, rather than reusing the first overview', () => {
    const nodes = movedCloud()
    const first = overviewPose(nodes, 1440, 900)
    for (const node of nodes) {
      node.x += 25000
      node.y *= 3
      node.z -= 12000
    }
    const updated = overviewPose(nodes, 1440, 900)
    expect(updated.target).not.toEqual(first.target)
    expectAllStarsInView(nodes, 1440, 900)
  })

  it('rejects incomplete coordinates instead of returning a broken camera', () => {
    expect(() => overviewPose([], 1440, 900)).toThrow()
    const nodes = movedCloud()
    nodes[0].x = Number.NaN
    expect(() => overviewPose(nodes, 1440, 900)).toThrow()
    nodes[0].x = Infinity
    expect(() => overviewPose(nodes, 1440, 900)).toThrow()
  })
})
