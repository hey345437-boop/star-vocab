import { useCallback, useEffect, useMemo, useRef } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { GraphLink, GraphNode, RelType, Root, Word, WordLink } from '../types'
import { useStore } from '../store/useStore'
import { makeNodeObject, setNodeState, glowTexture } from '../lib/threeNode'
import { hexA } from '../lib/render'
import { REL } from '../lib/rel'

interface Props {
  roots: Root[]
  words: Word[]
  wordLinks: WordLink[]
}

// 由 id 派生确定性随机（轨道平面用，保证每次聚焦同一颗星轨道一致）
function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}
function rand01(id: string): number {
  return (hashId(id) % 10000) / 10000
}
function seedVec(id: string): THREE.Vector3 {
  const a = rand01(id) * Math.PI * 2
  const b = rand01(id + 'y') * Math.PI * 2
  return new THREE.Vector3(Math.cos(a) * Math.sin(b), Math.sin(a) * Math.sin(b), Math.cos(b))
}

function buildGraph(roots: Root[], words: Word[], wordLinks: WordLink[]) {
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []

  for (const r of roots) {
    nodes.push({ id: r.id, kind: 'root', label: r.root, sub: r.meaning_zh, color: r.color, rootId: r.id, val: 8 })
  }
  for (const w of words) {
    const root = roots.find((r) => r.id === w.rootId)
    const color = root?.color ?? '#88aaff'
    nodes.push({ id: w.id, kind: 'word', label: w.word, sub: w.phonetic, color, rootId: w.rootId, val: 2 })
    // 词 → 词根（归属线，暗）
    links.push({ source: w.rootId, target: w.id, color: hexA(color, 0.16), kind: 'member', width: 0.4, baseHex: color, baseAlpha: 0.16 } as GraphLink)
  }
  // 词 → 词（关系线，彩色）
  for (const wl of wordLinks) {
    const c = REL[wl.type].color
    links.push({ source: wl.a, target: wl.b, color: hexA(c, 0.72), kind: 'rel', relType: wl.type, note: wl.note, width: 1.8, baseHex: c, baseAlpha: 0.72 } as GraphLink)
  }
  // 统计每个节点的连接数 → 决定星星体型（枢纽词更大）
  const deg: Record<string, number> = {}
  for (const l of links) {
    deg[l.source as unknown as string] = (deg[l.source as unknown as string] || 0) + 1
    deg[l.target as unknown as string] = (deg[l.target as unknown as string] || 0) + 1
  }
  for (const n of nodes) (n as any).deg = deg[n.id] || 0
  return { nodes, links }
}

// 取一条连线两端的 id（graphData 处理前是 id 字符串，处理后会被替换成节点对象）
function endId(v: any): string {
  return typeof v === 'object' && v ? v.id : v
}

export default function StarMap({ roots, words, wordLinks }: Props) {
  const fgRef = useRef<any>(null)
  const data = useMemo(() => buildGraph(roots, words, wordLinks), [roots, words, wordLinks])

  const progress = useStore((s) => s.progress)
  const selectedWordId = useStore((s) => s.selectedWordId)
  const focusRootId = useStore((s) => s.focusRootId)
  const bloomOn = useStore((s) => s.bloom)
  const selectWord = useStore((s) => s.selectWord)
  const focusRoot = useStore((s) => s.focusRoot)

  // 已掌握集合
  const masteredSet = useMemo(() => {
    const s = new Set<string>()
    for (const id in progress) if (progress[id]?.status === 'mastered') s.add(id)
    return s
  }, [progress])

  // 每个词 → 与它直接相连的关系线（溯源点亮用），key 用 id，稳定
  const relIncidence = useMemo(() => {
    const m = new Map<string, GraphLink[]>()
    for (const l of data.links) {
      if (l.kind !== 'rel') continue
      for (const id of [endId(l.source), endId(l.target)]) {
        const arr = m.get(id) ?? []
        arr.push(l)
        m.set(id, arr)
      }
    }
    return m
  }, [data])

  // 探险着色用的 refs（动画循环里读，避免闭包过期）
  const selectedRef = useRef<string | null>(null)
  const focusRef = useRef<string | null>(null)
  const masteredRef = useRef<Set<string>>(masteredSet)
  const neighborRef = useRef<Set<string>>(new Set())
  const exploreRef = useRef(false)
  const distRef = useRef(9999)
  const arrivedRef = useRef(false) // 镜头是否已飞拢到选中星
  const didFit = useRef(false)
  const tmpVec = useRef(new THREE.Vector3())
  const NEAR = 280 // 镜头到选中星 < 此值 = 算"已飞拢"
  const FAR = 380 // 飞拢后又拉远超过此值 = 视为缩小回概览（全部上色）

  // 公转 / 自转 / 后处理用的 refs
  const orbitRef = useRef<{ root: string; Rp: THREE.Vector3; items: { n: any; u: THREE.Vector3; v: THREE.Vector3; radius: number; theta: number; omega: number }[] } | null>(null)
  const bloomRef = useRef<UnrealBloomPass | null>(null)
  const linkHiRef = useRef<{ active: boolean; start: number; items: { l: GraphLink; relHex: string; delay: number }[] } | null>(null)
  const draggingRef = useRef(false)
  const idleSinceRef = useRef(0)
  const centerRef = useRef(new THREE.Vector3())
  const pulseArr = useRef<any[]>([])
  const spinArr = useRef<any[]>([])
  const cachedAnim = useRef(false)
  const listenersOn = useRef(false)
  const uniqMats = useRef(false)
  const lookTargetRef = useRef<THREE.Vector3 | null>(null) // 选中/聚焦时相机要持续注视的点（TrackballControls 下 cameraPosition 的 lookAt 不可靠，自己每帧 lerp）
  const tmpCol = useRef(new THREE.Color())

  // 给每颗星套用当前的探险着色状态
  function applyColors() {
    const explore = exploreRef.current
    const nb = neighborRef.current
    for (const n of data.nodes as any[]) {
      const g = n.__threeObj
      if (!g) continue
      setNodeState(g, { explore, mastered: masteredRef.current.has(n.id), selected: n.kind === 'word' && n.id === selectedRef.current, neighbor: nb.has(n.id) })
    }
  }

  // ---- 关系线材质操作（直接改 three-forcegraph 的 __lineObj.material，不触发重建）----
  // 注意：连线渲染对象挂在 __lineObj（节点才是 __threeObj），粒子挂在 __photonsObj
  function linkMat(l: GraphLink): any {
    return ((l as any).__lineObj || (l as any).__linkThreeObj)?.material
  }
  function setPhotons(l: GraphLink, on: boolean) {
    const p = (l as any).__photonsObj
    if (p) p.visible = on
  }
  function restoreLink(l: GraphLink) {
    const m = linkMat(l)
    if (m) {
      m.color.set((l as any).baseHex)
      if (m.emissive) m.emissive.setRGB(0, 0, 0)
      m.opacity = (l as any).baseAlpha
      m.transparent = (l as any).baseAlpha < 1
    }
    setPhotons(l, true)
  }
  function dimLink(l: GraphLink) {
    const m = linkMat(l)
    if (m) {
      if (m.emissive) m.emissive.setRGB(0, 0, 0)
      m.opacity = (l as any).baseAlpha * 0.12
      m.transparent = true
    }
    setPhotons(l, false) // 非链路收掉粒子，画面更干净
  }
  function litLink(l: GraphLink, relHex: string, k: number) {
    const m = linkMat(l)
    if (!m) return
    m.color.set(relHex)
    // emissive 是被 Bloom 放大成"发光粗带"的元凶，压到很低 → 线看得见但不抢戏
    if (m.emissive) {
      const c = tmpCol.current.set(relHex)
      m.emissive.setRGB(c.r * k * 0.15, c.g * k * 0.15, c.b * k * 0.15)
    }
    m.opacity = 0.18 + 0.32 * k // 最高 ~0.5，含蓄
    m.transparent = m.opacity < 1
    if (k > 0.5) setPhotons(l, true) // 点亮过半再把粒子放出来，呼应"依次亮起"
  }

  // 选中一个词 → 锁灰全场、点亮它的关系链（并安排"依次亮起"的涟漪）
  function setupChain(sel: string, t: number) {
    const incident = relIncidence.get(sel) ?? []
    const nb = new Set<string>()
    for (const l of incident) {
      const a = endId((l as any).source)
      const b = endId((l as any).target)
      nb.add(a === sel ? b : a)
    }
    neighborRef.current = nb
    for (const l of data.links) dimLink(l)
    const items = incident.map((l, i) => ({ l, relHex: REL[(l as any).relType as RelType].color, delay: i * 0.09 }))
    linkHiRef.current = { active: true, start: t, items }
  }
  function clearChain() {
    neighborRef.current = new Set()
    linkHiRef.current = null
    for (const l of data.links) restoreLink(l)
  }

  // ---- 聚焦词根 → 该系词星绕根星缓慢公转 ----
  function startOrbit(rootId: string) {
    const fg = fgRef.current
    const R: any = data.nodes.find((n) => n.id === rootId)
    if (!fg || !R || R.x == null) return
    flyTo(rootId, 175, 'root')
    const Rp = new THREE.Vector3(R.x, R.y, R.z)
    const items: NonNullable<typeof orbitRef.current>['items'] = []
    for (const n of data.nodes as any[]) {
      if (n.kind !== 'word' || n.rootId !== rootId || n.x == null) continue
      const off = new THREE.Vector3(n.x - R.x, n.y - R.y, n.z - R.z)
      let radius = off.length()
      if (radius < 14) {
        radius = 14
        off.set(1, 0, 0).multiplyScalar(14)
      }
      const u = off.clone().normalize() // θ=0 时落在原位 → 起步无跳变
      // 由 id 派生一个稳定的、与 u 垂直的方向，构成 3D 倾斜轨道平面
      const s = seedVec(n.id)
      const nrm = s.clone().sub(u.clone().multiplyScalar(s.dot(u)))
      if (nrm.lengthSq() < 1e-4) nrm.set(0, 1, 0)
      nrm.normalize()
      const v = new THREE.Vector3().crossVectors(nrm, u).normalize()
      const omega = (Math.PI * 2) / 22 * (0.85 + rand01(n.id + 'w') * 0.3) // ~22 秒一圈，慢而稳，轻微差速
      items.push({ n, u, v, radius, theta: 0, omega })
    }
    // 把全场都钉住 → 重新加热引擎时其余星星纹丝不动，只有我们逐帧改写的词星在动
    for (const n of data.nodes as any[]) {
      n.fx = n.x
      n.fy = n.y
      n.fz = n.z
    }
    orbitRef.current = { root: rootId, Rp, items }
    // cooldownTime/Ticks 由 props 绑定 focusRootId 控制（聚焦期=Infinity，引擎持续 tick，连线才跟着词星走）；
    // 这里只负责重新加热让它从冷却态恢复转动
    fg.d3ReheatSimulation()
  }
  function stopOrbit() {
    orbitRef.current = null // props 随 focusRootId 归位 → 引擎按 5000ms 自然冷却停转（节点保持钉住，布局不乱）
  }

  // 重新判定是否处于聚焦态：选中了词，且（还在飞入途中 或 镜头仍近）
  function recomputeExplore() {
    const sel = selectedRef.current
    const explore = sel != null && (!arrivedRef.current || distRef.current <= FAR)
    if (explore !== exploreRef.current) {
      exploreRef.current = explore
      return true
    }
    return false
  }

  // 掌握度变化 → 更新已掌握集合 + 重新着色（点亮）
  useEffect(() => {
    masteredRef.current = masteredSet
    applyColors()
  }, [masteredSet])

  // 力学：松散张开
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('charge')?.strength(-180)
    fg.d3Force('link')?.distance((l: any) => (l.kind === 'member' ? 22 : 120))
    fg.d3Force('link')?.strength((l: any) => (l.kind === 'member' ? 0.9 : 0.05))
  }, [])

  // 真·泛光：往后处理 composer 里塞 UnrealBloomPass（+ OutputPass 修正 sRGB）
  useEffect(() => {
    let cancelled = false
    let cleanup = () => {}
    const setup = () => {
      if (cancelled) return
      const fg = fgRef.current
      const composer = fg?.postProcessingComposer?.()
      if (!composer) {
        requestAnimationFrame(setup)
        return
      }
      const res = new THREE.Vector2(window.innerWidth, window.innerHeight)
      // strength / radius / threshold —— 柔强度(0.4)+宽半径(0.72)+中阈值(0.4)：
      // 宽半径给"朦胧软光雾"的梦幻veil，但强度压低、阈值抬高 → 飞近亮星时不会糊成一团；背景仍近黑不抬灰
      // 想更朦胧/更收敛只需调这三个数：strength 越大越亮、radius 越大越糊、threshold 越低参与发光的东西越多
      const bloom = new UnrealBloomPass(res, 0.4, 0.72, 0.4)
      bloom.enabled = useStore.getState().bloom
      // 不加 OutputPass：3d-force-graph 自己管 renderer 的输出色彩空间，
      // 再叠一个 OutputPass 会把近黑背景抬成灰雾
      composer.addPass(bloom)
      bloomRef.current = bloom
      const onResize = () => bloom.setSize(window.innerWidth, window.innerHeight)
      window.addEventListener('resize', onResize)
      cleanup = () => window.removeEventListener('resize', onResize)
    }
    setup()
    return () => {
      cancelled = true
      cleanup()
    }
  }, [])

  // 泛光开关
  useEffect(() => {
    if (bloomRef.current) bloomRef.current.enabled = bloomOn
  }, [bloomOn])

  // 场景里铺一层 3D 星海（真景深）+ 主动画循环（自转/公转/溯源/脉动/流星，全在这一个 rAF 里）
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const scene = fg.scene()
    const N = 1600
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      const r = 700 + Math.random() * 1000
      const th = Math.random() * Math.PI * 2
      const ph = Math.acos(2 * Math.random() - 1)
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th)
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th)
      pos[i * 3 + 2] = r * Math.cos(ph)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({ size: 2.2, color: '#aab8ff', transparent: true, opacity: 0.75, sizeAttenuation: true })
    const pts = new THREE.Points(geo, mat)
    pts.name = 'bg-stars'
    scene.add(pts)

    // 彩色星云（少而大、分散、更饱和 → 更"赛博"不发灰）
    const nebulaColors = ['#7AA2FF', '#BB9AF7', '#2AC3DE', '#F7768E', '#FFB86C']
    const nebula = new THREE.Group()
    nebula.name = 'nebula'
    for (let i = 0; i < 5; i++) {
      const col = nebulaColors[i % nebulaColors.length]
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTexture(col), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.16 }),
      )
      const size = 320 + Math.random() * 360
      sp.scale.set(size, size, 1)
      const ang = (i / 5) * Math.PI * 2 + Math.random()
      sp.position.set(Math.cos(ang) * (260 + Math.random() * 220), Math.sin(ang) * (200 + Math.random() * 160), -260 - Math.random() * 380)
      nebula.add(sp)
    }
    scene.add(nebula)

    // 流星系统（偶发划过）
    const whiteTex = glowTexture('#ffffff')
    const meteors: THREE.Sprite[] = []
    function spawnMeteor() {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: whiteTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95 }))
      sp.position.set((Math.random() - 0.3) * 500, 140 + Math.random() * 160, (Math.random() - 0.5) * 160)
      const vx = -150 - Math.random() * 160
      const vy = -110 - Math.random() * 90
      sp.material.rotation = Math.atan2(vy, vx)
      sp.scale.set(46, 3.2, 1)
      sp.userData.meteor = { vel: new THREE.Vector3(vx, vy, 0), life: 0, max: 1.5 }
      scene.add(sp)
      meteors.push(sp)
    }
    let meteorTimer = 1.5 + Math.random() * 2.5

    let raf = 0
    let t = 0
    let last = performance.now()
    const loop = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      t += dt

      const store = useStore.getState()
      const curSel = store.selectedWordId
      const curFocus = store.focusRootId

      // 选中态变化（直接读 store，不等 React 渲染时机）→ 即时锁灰 + 飞入 + 溯源点亮
      if (curSel !== selectedRef.current) {
        selectedRef.current = curSel
        arrivedRef.current = false
        exploreRef.current = curSel != null
        if (curSel) {
          setupChain(curSel, t)
          flyTo(curSel, 185, 'word') // 别贴太近，否则泛光下点亮的关系线会糊满整屏
        } else {
          clearChain()
        }
        applyColors()
      }
      // 聚焦词根变化 → 起/停公转
      if (curFocus !== focusRef.current) {
        if (curFocus) startOrbit(curFocus)
        else stopOrbit()
        focusRef.current = curFocus
      }
      // 既没选词也没聚焦 → 放掉注视点，让闲置自转重新对准星系中心
      if (curSel == null && curFocus == null) lookTargetRef.current = null

      // 跟踪"镜头到选中星"的距离 → 概览/聚焦切换时重新着色
      const cam = fg.camera?.()
      if (cam) {
        const sel = selectedRef.current
        if (sel) {
          const n: any = data.nodes.find((nn) => nn.id === sel)
          distRef.current = n && n.x != null ? cam.position.distanceTo(tmpVec.current.set(n.x, n.y, n.z)) : 9999
          if (distRef.current < NEAR) arrivedRef.current = true
        } else {
          distRef.current = 9999
        }
        if (recomputeExplore()) applyColors()
      }

      // ① 星河缓慢自转：闲置（没选词/没聚焦/没拖拽）超过 1.2s 才开始转，操作时立刻停。
      // 手动绕星系中心转相机（默认 controls 是 TrackballControls，没有 autoRotate，所以不能靠它）
      const controls = fg.controls?.()
      if (controls && cam) {
        if (!listenersOn.current) {
          controls.addEventListener('start', () => {
            draggingRef.current = true
          })
          controls.addEventListener('end', () => {
            draggingRef.current = false
            idleSinceRef.current = 0
          })
          listenersOn.current = true
        }
        const interacting = curSel != null || curFocus != null || draggingRef.current
        if (interacting) {
          idleSinceRef.current = 0
          // 选中/聚焦时：每帧把注视点拉向目标星（飞入时同步对准，停下后保持居中）
          if (lookTargetRef.current && controls.target && !draggingRef.current) {
            controls.target.lerp(lookTargetRef.current, 0.18)
          }
        } else {
          if (idleSinceRef.current === 0) idleSinceRef.current = now
          if (now - idleSinceRef.current > 1200) {
            const c = centerRef.current
            const dx = cam.position.x - c.x
            const dz = cam.position.z - c.z
            const a = 0.06 * dt // ~0.06 rad/s，约 100 秒一圈，电影级缓慢环绕
            const cs = Math.cos(a)
            const sn = Math.sin(a)
            cam.position.x = c.x + dx * cs - dz * sn
            cam.position.z = c.z + dx * sn + dz * cs
            if (controls.target) controls.target.lerp(c, 0.02) // 旋转中心轻柔拉回星系质心；controls.update() 会据此 lookAt
          }
        }
      }

      // ② 聚焦时局部公转
      const orbit = orbitRef.current
      if (orbit) {
        for (const it of orbit.items) {
          it.theta += it.omega * dt
          const c = Math.cos(it.theta)
          const s = Math.sin(it.theta)
          const x = orbit.Rp.x + it.radius * (c * it.u.x + s * it.v.x)
          const y = orbit.Rp.y + it.radius * (c * it.u.y + s * it.v.y)
          const z = orbit.Rp.z + it.radius * (c * it.u.z + s * it.v.z)
          it.n.fx = x
          it.n.fy = y
          it.n.fz = z
          it.n.x = x
          it.n.y = y
          it.n.z = z
        }
      }

      // ④ 关系链"依次亮起"涟漪
      const hi = linkHiRef.current
      if (hi && hi.active) {
        let allDone = true
        for (const it of hi.items) {
          let k = (t - hi.start - it.delay) / 0.5
          k = k < 0 ? 0 : k > 1 ? 1 : k
          if (k < 1) allDone = false
          litLink(it.l, it.relHex, 1 - (1 - k) * (1 - k))
        }
        if (allDone) hi.active = false
      }

      // 背景缓旋
      pts.rotation.y += 0.0004
      nebula.rotation.y -= 0.0002

      // 星星"呼吸"脉动 + 词根线框行星自转（缓存数组，免每帧全场 traverse）
      if (cachedAnim.current) {
        for (const o of pulseArr.current) {
          const p = o.userData.pulse
          const s = p.base * (1 + p.amp * Math.sin(t * 1.8 + p.phase))
          o.scale.set(s, s, 1)
        }
        for (const o of spinArr.current) {
          const sp = o.userData.spin
          o.rotation.y += sp
          o.rotation.x += sp * 0.45
        }
      }

      // 流星
      meteorTimer -= dt
      if (meteorTimer <= 0) {
        spawnMeteor()
        meteorTimer = 2.5 + Math.random() * 4
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i]
        const u = m.userData.meteor
        u.life += dt
        m.position.addScaledVector(u.vel, dt)
        m.material.opacity = Math.max(0, 1 - u.life / u.max) * 0.95
        if (u.life >= u.max) {
          scene.remove(m)
          m.material.dispose()
          meteors.splice(i, 1)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      scene.remove(pts)
      scene.remove(nebula)
      meteors.forEach((m) => scene.remove(m))
      geo.dispose()
      mat.dispose()
    }
  }, [])

  // 飞向某个节点（kind 用于消歧：词和词根可能同 id，如 scope/scope）
  function flyTo(id: string, distance: number, kind?: 'root' | 'word') {
    const n: any = data.nodes.find((nn) => nn.id === id && (!kind || nn.kind === kind))
    if (!n || n.x == null || !fgRef.current) return
    const d = Math.hypot(n.x, n.y, n.z) || 1
    const k = 1 + distance / d
    fgRef.current.cameraPosition({ x: n.x * k, y: n.y * k, z: n.z * k }, n, 900)
    // 关键：自己接管注视点，循环里每帧把 controls.target lerp 到这颗星，
    // 否则闲置自转把 target 拉到星系中心后，cameraPosition 的 lookAt 拉不回来 → 星不居中
    lookTargetRef.current = new THREE.Vector3(n.x, n.y, n.z)
  }

  // 算星系质心（自转的旋转中心）+ 缓存脉动/自转对象（perf）
  function computeCenter() {
    let cx = 0
    let cy = 0
    let cz = 0
    let cnt = 0
    for (const n of data.nodes as any[]) {
      if (n.x == null) continue
      cx += n.x
      cy += n.y
      cz += n.z
      cnt++
    }
    if (cnt) centerRef.current.set(cx / cnt, cy / cnt, cz / cnt)
  }
  function cacheAnim() {
    pulseArr.current = []
    spinArr.current = []
    fgRef.current?.scene().traverse((o: any) => {
      if (o.userData?.pulse) pulseArr.current.push(o)
      if (o.userData?.spin) spinArr.current.push(o)
    })
    cachedAnim.current = true
  }

  // 关键修复：three-forcegraph 给同色连线共用同一个材质对象（rel 线只有 4 种颜色）。
  // 若不拆开，dimLink/litLink 改一条 = 改了同色全部线 → 选中时整片同色线一起亮/暗。
  // 渲染后把每条线的材质 clone 成独立实例，逐条操作才生效。
  function uniquifyLinkMaterials() {
    if (uniqMats.current) return
    let done = 0
    for (const l of data.links as any[]) {
      const o = l.__lineObj || l.__linkThreeObj
      if (o && o.material) {
        if (!o.material.__uniq) {
          o.material = o.material.clone()
          o.material.__uniq = true
        }
        done++
      }
    }
    if (done === data.links.length) uniqMats.current = true // 全部就位才置标志，否则下次 onEngineStop 再补
  }

  // 稳定引用的 accessor：避免选中时 react-force-graph 推倒重建全部节点/连线几何（卡顿+变灰延迟的根因）
  const nodeThreeObject = useCallback((node: any) => makeNodeObject(node), [])
  const linkWidthFn = useCallback((l: any) => l.width, [])
  const linkParticlesFn = useCallback((l: any) => (l.kind === 'rel' ? 2 : 0), [])
  const linkColorFn = useCallback((l: any) => l.color, [])

  return (
    <div className="graph-layer">
      <ForceGraph3D
        ref={fgRef}
        graphData={data}
        backgroundColor="#05060f"
        showNavInfo={false}
        cooldownTime={focusRootId ? Infinity : 5000}
        cooldownTicks={focusRootId ? Infinity : undefined}
        onEngineStop={() => {
          // 只在初次、且用户还没点开任何词时自动 fit，避免把用户的飞入拽回去
          if (!didFit.current && !selectedRef.current) fgRef.current?.zoomToFit(900, 120)
          didFit.current = true
          computeCenter()
          cacheAnim()
          uniquifyLinkMaterials()
          applyColors()
        }}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={linkColorFn}
        linkWidth={linkWidthFn}
        linkDirectionalParticles={linkParticlesFn}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleSpeed={0.014}
        onNodeHover={(node: any) => {
          document.body.style.cursor = node ? 'pointer' : ''
        }}
        onNodeClick={(node: any) => {
          if (node.kind === 'root') {
            focusRoot(node.id)
            selectWord(null)
          } else {
            selectWord(node.id)
            focusRoot(null)
          }
        }}
        onBackgroundClick={() => {
          selectWord(null)
          focusRoot(null)
        }}
      />
    </div>
  )
}
