import type { GraphNode, Mastery } from '../types'

// #RRGGBB -> rgba()
export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

// 在 force-graph 的 canvas 上画一颗发光的"星"
export function drawNode(
  node: GraphNode & { x?: number; y?: number },
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  mastery: Mastery,
  selected: boolean,
) {
  const x = node.x ?? 0
  const y = node.y ?? 0
  const isRoot = node.kind === 'root'

  // 掌握度 → 亮度（词根恒星永远最亮）
  const lit = isRoot ? 1 : mastery === 'mastered' ? 1 : mastery === 'fuzzy' ? 0.6 : 0.28
  const coreR = isRoot ? 7 : 3.5
  const glowR = isRoot ? 22 : 6 + lit * 12

  // 外层辉光
  const grad = ctx.createRadialGradient(x, y, 0, x, y, glowR)
  grad.addColorStop(0, hexA(node.color, 0.9 * lit))
  grad.addColorStop(0.35, hexA(node.color, 0.35 * lit))
  grad.addColorStop(1, hexA(node.color, 0))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, glowR, 0, Math.PI * 2)
  ctx.fill()

  // 选中环
  if (selected) {
    ctx.strokeStyle = hexA('#ffffff', 0.9)
    ctx.lineWidth = 1.5 / globalScale
    ctx.beginPath()
    ctx.arc(x, y, coreR + 5, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 内核
  ctx.beginPath()
  ctx.arc(x, y, coreR, 0, Math.PI * 2)
  ctx.fillStyle = isRoot ? node.color : hexA('#ffffff', 0.35 + 0.65 * lit)
  ctx.fill()

  // 文字标签
  const fontSize = (isRoot ? 5 : 3.4) / globalScale
  ctx.font = `${isRoot ? 700 : 400} ${fontSize}px -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = hexA('#e8ecff', isRoot ? 0.95 : 0.4 + 0.6 * lit)
  const label = isRoot ? `${node.label}` : node.label
  ctx.fillText(label, x, y + coreR + 2)

  // 词根再补一行中文含义
  if (isRoot && node.sub) {
    ctx.font = `${3.2 / globalScale}px -apple-system, sans-serif`
    ctx.fillStyle = hexA('#8b93c2', 0.9)
    ctx.fillText(node.sub, x, y + coreR + 2 + fontSize + 1)
  }
}
