interface Point { x: number; y: number; z: number }
export interface OverviewPose { position: Point; target: Point; radius: number; distance: number }

// A first-frame fit must use real node coordinates, never unrendered mesh matrices.
// Fitting a bounding sphere keeps the whole scene visible during the slow overview orbit too.
export function overviewPose(nodes: readonly Point[], width: number, height: number, fov = 50, padding = 120): OverviewPose {
  if (!nodes.length || !nodes.every(node => [node.x, node.y, node.z].every(Number.isFinite))) throw new Error('星图坐标尚未准备好')
  const target = { x: 0, y: 0, z: 0 }
  for (const axis of ['x', 'y', 'z'] as const) {
    const values = nodes.map(node => node[axis])
    target[axis] = (Math.min(...values) + Math.max(...values)) / 2
  }
  const radius = Math.max(...nodes.map(node => Math.hypot(node.x - target.x, node.y - target.y, node.z - target.z))) + 30
  const aspect = Math.max(1, width) / Math.max(1, height)
  const usableHeight = Math.max(0.45, 1 - 2 * padding / Math.max(1, height))
  const verticalHalfAngle = Math.atan(Math.tan(fov * Math.PI / 360) * usableHeight)
  const halfAngle = Math.atan(Math.tan(verticalHalfAngle) * Math.min(1, aspect))
  const distance = radius / Math.sin(halfAngle)
  return { position: { x: target.x, y: target.y, z: target.z + distance }, target, radius, distance }
}
