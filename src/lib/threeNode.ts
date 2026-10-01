import * as THREE from 'three'
import SpriteText from 'three-spritetext'
import type { GraphNode, Mastery } from '../types'
import { hexA } from './render'

// 锁定（未掌握 + 聚焦态）时星星褪成的灰
export const GREY = new THREE.Color(0x3a4055)
const WHITE = new THREE.Color(0xffffff)
const LABEL_ON = new THREE.Color(0xffffff)
const LABEL_GREY = new THREE.Color(0x6b7290)

// 柔和辉光贴图（光晕用），靠 material.color 染色
let glowT: THREE.Texture | null = null
function glowTex(): THREE.Texture {
  if (glowT) return glowT
  const s = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  glowT = new THREE.CanvasTexture(cv)
  return glowT
}

// 紧致亮核（让星星有清亮的"光点"，柔和不刺眼）
let sparkT: THREE.Texture | null = null
function sparkTex(): THREE.Texture {
  if (sparkT) return sparkT
  const s = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.16, 'rgba(255,255,255,0.92)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.18)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  sparkT = new THREE.CanvasTexture(cv)
  return sparkT
}

// 柔和光环（词根恒星的"日冕"，平滑环状，无尖角）
let ringT: THREE.Texture | null = null
function ringTex(): THREE.Texture {
  if (ringT) return ringT
  const s = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.42, 'rgba(255,255,255,0)')
  g.addColorStop(0.62, 'rgba(255,255,255,0.32)')
  g.addColorStop(0.8, 'rgba(255,255,255,0.08)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  ringT = new THREE.CanvasTexture(cv)
  return ringT
}

// 兼容旧命名（星云用得到）
export function glowTexture(hex: string): THREE.Texture {
  const size = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, hexA(hex, 1))
  g.addColorStop(0.22, hexA(hex, 0.6))
  g.addColorStop(1, hexA(hex, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(cv)
}

// 由 id 派生确定性随机（每颗星的色调/大小微差）
function seed(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

function sprite(tex: THREE.Texture, size: number, opacity: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }))
  s.scale.set(size, size, 1)
  // Transparent glow rectangles must never steal clicks from nearby stars.
  s.raycast = () => {}
  return s
}

type TintMat = THREE.SpriteMaterial | THREE.MeshBasicMaterial | THREE.LineBasicMaterial

interface NodeUserData {
  isRoot: boolean
  onColor: THREE.Color
  parts: { mat: TintMat; base: number; white?: boolean }[]
  labelMat: THREE.SpriteMaterial
  labelSprite: THREE.Object3D
  subMat?: THREE.SpriteMaterial
}

// 一颗柔和有质感的星：大小随连接数、色调有微差、亮核 + 光晕（词根再加柔光环）
export function makeNodeObject(node: GraphNode): THREE.Object3D {
  const isRoot = node.kind === 'root'
  const deg: number = (node as any).deg ?? 0
  // Scene keys distinguish roots from words; keep the original word's appearance.
  const visualId = (node as GraphNode & { rawId?: string }).rawId ?? node.id
  const sd = seed(visualId)

  // 同簇内色调深浅 + 轻微色相偏移
  const onColor = new THREE.Color(node.color)
  onColor.offsetHSL((sd - 0.5) * 0.04, (seed(visualId + 'x') - 0.5) * 0.12, (sd - 0.5) * 0.18)

  const group = new THREE.Group()
  const parts: NodeUserData['parts'] = []
  const boost = Math.min(deg, 10)

  const coreR = isRoot ? 2.6 : 0.9 + boost * 0.11
  const haloIn = isRoot ? 22 : 6 + boost * 0.8
  const haloOut = isRoot ? 52 : 14 + boost * 1.4
  const hitSphere = new THREE.Sphere()
  const hitPoint = new THREE.Vector3()
  const hitRadius = isRoot ? coreR * 3.2 : coreR + 1.5
  group.raycast = (raycaster, intersections) => {
    group.getWorldPosition(hitSphere.center)
    hitSphere.radius = hitRadius * group.matrixWorld.getMaxScaleOnAxis()
    if (!raycaster.ray.intersectSphere(hitSphere, hitPoint)) return
    const distance = raycaster.ray.origin.distanceTo(hitPoint)
    if (distance >= raycaster.near && distance <= raycaster.far) {
      intersections.push({ distance, point: hitPoint.clone(), object: group })
    }
  }

  // 外层弥散光晕 + 内层柔光（带呼吸脉动）
  const addHalo = (size: number, base: number, amp: number) => {
    const s = sprite(glowTex(), size, base)
    s.material.color.copy(onColor)
    s.userData.pulse = { base: size, amp, phase: sd * Math.PI * 2 }
    parts.push({ mat: s.material as THREE.SpriteMaterial, base })
    group.add(s)
  }
  addHalo(haloOut, isRoot ? 0.3 : 0.28, isRoot ? 0.07 : 0.14)
  addHalo(haloIn, isRoot ? 0.58 : 0.72, isRoot ? 0.05 : 0.09)

  // 词根 = 一颗自转的线框全息行星
  if (isRoot) {
    const wf = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(coreR * 3.2, 16, 10)),
      new THREE.LineBasicMaterial({ color: onColor.clone(), transparent: true, opacity: 0.5, depthWrite: false }),
    )
    wf.userData.spin = 0.008
    parts.push({ mat: wf.material as THREE.LineBasicMaterial, base: 0.5 })
    group.add(wf)
  }

  // 实心内核
  const coreMat = new THREE.MeshBasicMaterial({ color: isRoot ? onColor.clone() : WHITE.clone(), transparent: true, opacity: 1 })
  group.add(new THREE.Mesh(new THREE.SphereGeometry(coreR, 16, 16), coreMat))
  parts.push({ mat: coreMat, base: 1, white: !isRoot })

  // 紧致亮核光点（柔和的"星点"，让每颗都清亮）
  const spk = sprite(sparkTex(), isRoot ? 12 : 4 + boost * 0.5, isRoot ? 0.95 : 0.85)
  spk.material.color.copy(isRoot ? onColor : WHITE)
  parts.push({ mat: spk.material as THREE.SpriteMaterial, base: isRoot ? 0.95 : 0.85, white: !isRoot })
  group.add(spk)

  // Keep the original overview: roots and words are labeled without needing a hover.
  const label = new SpriteText(node.label)
  label.color = isRoot ? `#${onColor.getHexString()}` : hexA('#e8ecff', 0.9)
  label.textHeight = isRoot ? 3.6 : 2.4
  label.fontWeight = isRoot ? '700' : '500'
  label.position.set(0, -(coreR + (isRoot ? 4 : 2.6)), 0)
  label.material.depthWrite = false
  label.raycast = () => {}
  group.add(label)

  let subMat: THREE.SpriteMaterial | undefined
  if (isRoot && node.sub) {
    const sub = new SpriteText(node.sub)
    sub.color = '#8b93c2'
    sub.textHeight = 2.2
    sub.position.set(0, -(coreR + 4 + 3.6), 0)
    sub.material.depthWrite = false
    sub.raycast = () => {}
    subMat = sub.material as THREE.SpriteMaterial
    group.add(sub)
  }

  const ud: NodeUserData = { isRoot, onColor, parts, labelMat: label.material as THREE.SpriteMaterial, labelSprite: label, subMat }
  group.userData.node = ud
  setNodeState(group, { explore: false, mastered: false, selected: false })
  return group
}

interface State { explore: boolean; mastered: boolean; selected: boolean; neighbor?: boolean; hovered?: boolean; mastery?: Mastery }

// 动态设置颜色 / 亮度（探险点亮机制；neighbor = 选中词的关系链邻居，跟着点亮不锁灰）
export function setNodeState(group: THREE.Object3D, st: State) {
  const ud = group.userData.node as NodeUserData | undefined
  if (!ud) return
  const locked = st.explore && !st.mastered && !st.selected && !st.neighbor
  const lit = st.selected ? 1 : st.neighbor ? 0.9 : st.mastered ? 1 : st.explore ? 0.26 : st.mastery === 'fuzzy' ? 0.9 : 0.82
  const col = locked ? GREY : ud.onColor
  ud.labelSprite.visible = true

  for (const p of ud.parts) {
    if (p.white) p.mat.color.copy(locked ? GREY : WHITE)
    else p.mat.color.copy(col)
    p.mat.opacity = p.base === 1 ? (ud.isRoot ? (locked ? 0.5 : 1) : 0.35 + 0.55 * lit) : p.base * lit
  }
  ud.labelMat.color.copy(locked ? LABEL_GREY : LABEL_ON)
  ud.labelMat.opacity = locked ? 0.5 : 1
  if (ud.subMat) {
    ud.subMat.color.copy(locked ? LABEL_GREY : LABEL_ON)
    ud.subMat.opacity = locked ? 0.5 : 1
  }
}
