import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { Root, Word, WordLink } from '../types'
import { useStore } from '../store/useStore'
import { makeNodeObject, setNodeState, glowTexture } from '../lib/threeNode'
import { buildSceneGraph, endpointKey, nodeKey, randomFor, type SceneLink, type SceneNode } from '../lib/sceneGraph'
import { overviewPose } from '../lib/sceneCamera'

interface Props { roots: Root[]; words: Word[]; wordLinks: WordLink[]; onUnavailable?: () => void }
type RenderNode = SceneNode & { __threeObj?: THREE.Object3D }
type RenderLink = SceneLink & { __lineObj?: THREE.Line; __photonsObj?: THREE.Group }
interface Runtime { layoutReady: () => void; hover: (node: RenderNode | null) => void }

// Stable accessors avoid rebuilding hundreds of objects on a UI update.
const nodeObject = (node: RenderNode) => makeNodeObject(node)
const linkColor = (link: SceneLink) => link.color
const linkMaterial = (link: SceneLink) => new THREE.LineBasicMaterial({
  color: link.baseHex, transparent: true, opacity: link.baseAlpha, depthWrite: false,
})
const relationParticles = (link: SceneLink) => link.kind === 'rel' ? 2 : 0

function StarMap({ roots, words, wordLinks, onUnavailable }: Props) {
  const graphRef = useRef<any>(null)
  const runtimeRef = useRef<Runtime | null>(null)
  const pendingReady = useRef<object | null>(null)
  const unavailableRef = useRef(onUnavailable)
  unavailableRef.current = onUnavailable
  const graph = useMemo(() => buildSceneGraph(roots, words, wordLinks), [roots, words, wordLinks])
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const onEngineStop = useCallback(() => {
    pendingReady.current = graph
    runtimeRef.current?.layoutReady()
  }, [graph])
  const onHover = useCallback((node: RenderNode | null) => runtimeRef.current?.hover(node), [])
  const onNodeClick = useCallback((node: RenderNode) => {
    const store = useStore.getState()
    if (node.kind === 'root') store.focusRoot(node.rawId)
    else store.selectWord(node.rawId)
  }, [])
  const onBackgroundClick = useCallback(() => {
    const store = useStore.getState()
    store.selectWord(null)
    store.focusRoot(null)
  }, [])

  useEffect(() => {
    const fg = graphRef.current
    if (!fg) return
    const scene: THREE.Scene = fg.scene()
    const controls = fg.controls()
    const renderer: THREE.WebGLRenderer = fg.renderer()
    const composer = fg.postProcessingComposer()
    const camera: THREE.Camera = fg.camera()
    fg.d3Force('charge')?.strength(-180)
    fg.d3Force('link')?.distance((link: SceneLink) => link.kind === 'member' ? 22 : 120)
    fg.d3Force('link')?.strength((link: SceneLink) => link.kind === 'member' ? 0.9 : 0.05)
    let disposed = false
    let ready = false
    let hovered: RenderNode | null = null
    let selected: string | null = null
    let focused: string | null = null
    let neighbors = new Set<string>()
    let dragging = false
    let idleSince = performance.now()
    let navigationPending = true
    let cameraBusyUntil = 0
    let bloom: UnrealBloomPass | null = null
    let clock = 0
    let chainStart = 0
    let chain: RenderLink[] = []
    let lastPulse = 0
    let lastBreathing = 0
    const center = new THREE.Vector3()
    const temporary = new THREE.Vector3()
    let lookTarget: THREE.Vector3 | null = null
    const pulses: THREE.Object3D[] = []
    const spins: THREE.Object3D[] = []
    let orbit: { center: THREE.Vector3; items: { node: RenderNode; u: THREE.Vector3; v: THREE.Vector3; radius: number; theta: number; speed: number }[]; edges: RenderLink[] } | null = null

    function applyNode(node: RenderNode) {
      if (!node.__threeObj) return
      setNodeState(node.__threeObj, {
        explore: selected !== null,
        mastered: node.kind === 'word' && useStore.getState().progress[node.rawId]?.status === 'mastered',
        mastery: useStore.getState().progress[node.rawId]?.status ?? 'new',
        selected: node.id === selected,
        neighbor: neighbors.has(node.id), hovered: hovered?.id === node.id || (node.kind === 'word' && node.rootId === focused),
      })
    }
    function applyNodes() { graph.nodes.forEach((node) => applyNode(node as RenderNode)) }
    function resetLinks() {
      for (const link of graph.links as RenderLink[]) {
        const material = link.__lineObj?.material as THREE.LineBasicMaterial | undefined
        if (!material) continue
        material.color.set(link.baseHex)
        material.opacity = selected ? link.baseAlpha * 0.12 : link.baseAlpha
        if (link.__photonsObj) link.__photonsObj.visible = !selected || endpointKey(link.source) === selected || endpointKey(link.target) === selected
      }
    }
    function flyTo(node: RenderNode, distance: number) {
      const target = temporary.set(node.x, node.y, node.z)
      const direction = camera.position.clone().sub(target)
      if (direction.lengthSq() < 0.01) direction.set(0, 0, 1)
      direction.normalize().multiplyScalar(distance).add(target)
      fg.cameraPosition({ x: direction.x, y: direction.y, z: direction.z }, { x: node.x, y: node.y, z: node.z }, 700)
      cameraBusyUntil = performance.now() + 800
      lookTarget = target.clone()
    }
    function startOrbit(rootId: string) {
      const root = graph.nodeByKey.get(nodeKey('root', rootId))
      if (!root) return
      const orbitCenter = new THREE.Vector3(root.x, root.y, root.z)
      const items = (graph.wordNodesByRoot.get(rootId) ?? []).map((node) => {
        const offset = new THREE.Vector3(node.x, node.y, node.z).sub(orbitCenter)
        if (offset.lengthSq() < 196) offset.set(14, 0, 0)
        const radius = offset.length()
        const u = offset.normalize()
        const seed = new THREE.Vector3(Math.cos(randomFor(node.id) * Math.PI * 2), 0.7, Math.sin(randomFor(`${node.id}:y`) * Math.PI * 2))
        let v = seed.addScaledVector(u, -seed.dot(u))
        if (v.lengthSq() < 0.0001) v = new THREE.Vector3(0, 1, 0).cross(u)
        v.normalize()
        return { node: node as RenderNode, u, v, radius, theta: 0, speed: Math.PI * 2 / 22 * (0.85 + randomFor(`${node.id}:speed`) * 0.3) }
      })
      const edges = (graph.orbitEdgesByRoot.get(rootId) ?? []) as RenderLink[]
      for (const edge of edges) if (edge.__lineObj) edge.__lineObj.frustumCulled = false
      orbit = { center: orbitCenter, items, edges }
      flyTo(root as RenderNode, 175)
    }
    function navigate() {
      if (!ready) { navigationPending = true; return }
      navigationPending = false
      const state = useStore.getState()
      selected = state.selectedWordId ? nodeKey('word', state.selectedWordId) : null
      focused = selected ? null : state.focusRootId
      orbit = null
      chain = selected ? (graph.incidentRelations.get(selected) ?? []) as RenderLink[] : []
      neighbors = new Set(chain.flatMap((edge) => [endpointKey(edge.source), endpointKey(edge.target)]).filter((key) => key !== selected))
      chainStart = clock
      resetLinks()
      applyNodes()
      idleSince = performance.now()
      if (selected) {
        const node = graph.nodeByKey.get(selected)
        if (node) flyTo(node as RenderNode, 185)
      } else if (focused) startOrbit(focused)
      else {
        lookTarget = null
        // Repeated overview clicks must also restore the camera.
        const pose = overviewPose(graph.nodes, window.innerWidth, window.innerHeight, (camera as THREE.PerspectiveCamera).fov, 120)
        center.set(pose.target.x, pose.target.y, pose.target.z)
        fg.cameraPosition(pose.position, pose.target, 700)
        cameraBusyUntil = performance.now() + 800
      }
    }
    function layoutReady() {
      if (disposed || ready) return
      ready = true
      for (const node of graph.nodes as RenderNode[]) {
        node.fx = node.x; node.fy = node.y; node.fz = node.z
        node.__threeObj?.position.set(node.x, node.y, node.z)
        center.add(temporary.set(node.x, node.y, node.z))
        node.__threeObj?.traverse((object) => {
          if (object.userData.pulse) pulses.push(object)
          if (object.userData.spin) spins.push(object)
        })
      }
      center.divideScalar(Math.max(1, graph.nodes.length))
      scene.updateMatrixWorld(true)
      // Relations are visual guides, not click targets; a crossing line must not swallow a star click.
      for (const link of graph.links as RenderLink[]) if (link.__lineObj) link.__lineObj.raycast = () => {}
      if (navigationPending) navigate()
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(dpr)
    composer?.setPixelRatio(dpr)
    if (composer) {
      bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.72, 0.4)
      bloom.enabled = useStore.getState().bloom
      composer.addPass(bloom)
    }
    const onResize = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      setSize({ width, height })
      composer?.setSize(width, height)
      bloom?.setSize(width * dpr, height * dpr)
      if (ready && !selected && !focused) navigate()
    }
    const onContextLost = (event: Event) => {
      event.preventDefault()
      unavailableRef.current?.()
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)
    window.addEventListener('resize', onResize)
    const onStart = () => { dragging = true; lookTarget = null }
    const onEnd = () => { dragging = false; idleSince = performance.now() }
    controls?.addEventListener('start', onStart)
    controls?.addEventListener('end', onEnd)

    // A single subscription sends changes into this runtime; the frame loop never polls store navigation.
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.selectedWordId !== previous.selectedWordId || state.focusRootId !== previous.focusRootId || state.navigationNonce !== previous.navigationNonce) navigate()
      if (state.bloom !== previous.bloom && bloom) bloom.enabled = state.bloom
      if (state.progress !== previous.progress) {
        const changed = new Set([...Object.keys(state.progress), ...Object.keys(previous.progress)])
        for (const wordId of changed) {
          if (state.progress[wordId]?.status === previous.progress[wordId]?.status) continue
          const node = graph.nodeByKey.get(nodeKey('word', wordId))
          if (node) applyNode(node as RenderNode)
        }
      }
    })
    runtimeRef.current = {
      layoutReady,
      hover(node) {
        const previous = hovered
        hovered = node
        if (previous) applyNode(previous)
        if (node) applyNode(node)
      },
    }

    const background = new THREE.Group()
    background.name = 'star-vocab-background'
    const positions = new Float32Array(1600 * 3)
    for (let i = 0; i < 1600; i++) {
      const radius = 700 + randomFor(`bg:${i}`) * 1000
      const angle = randomFor(`bg-angle:${i}`) * Math.PI * 2
      const y = randomFor(`bg-y:${i}`) * 2 - 1
      const side = Math.sqrt(1 - y * y)
      positions.set([radius * side * Math.cos(angle), radius * y, radius * side * Math.sin(angle)], i * 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const backgroundMaterial = new THREE.PointsMaterial({ size: 2.2, color: '#aab8ff', transparent: true, opacity: 0.75, depthWrite: false })
    background.add(new THREE.Points(geometry, backgroundMaterial))
    const nebulaTextures: THREE.Texture[] = []
    for (const [index, color] of ['#7AA2FF', '#BB9AF7', '#2AC3DE', '#F7768E', '#FFB86C'].entries()) {
      const texture = glowTexture(color)
      nebulaTextures.push(texture)
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.16 }))
      const scale = 320 + randomFor(`nebula:${index}`) * 360
      const angle = index / 5 * Math.PI * 2 + randomFor(`nebula-angle:${index}`)
      sprite.scale.set(scale, scale, 1)
      sprite.position.set(Math.cos(angle) * (260 + randomFor(`nebula-x:${index}`) * 220), Math.sin(angle) * (200 + randomFor(`nebula-y:${index}`) * 160), -260 - randomFor(`nebula-z:${index}`) * 380)
      background.add(sprite)
    }
    scene.add(background)
    background.traverse((object) => { object.raycast = () => {} })

    const meteorTexture = glowTexture('#ffffff')
    const meteors: { sprite: THREE.Sprite; velocity: THREE.Vector3; life: number }[] = []
    let meteorCount = 0
    let meteorTimer = 1.5 + randomFor('meteor:first') * 2.5
    function updateMeteors(dt: number) {
      meteorTimer -= dt
      if (meteorTimer <= 0) {
        const seed = `meteor:${meteorCount++}`
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: meteorTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95 }))
        sprite.position.set((randomFor(seed) - 0.3) * 500, 140 + randomFor(`${seed}:y`) * 160, (randomFor(`${seed}:z`) - 0.5) * 160)
        const velocity = new THREE.Vector3(-150 - randomFor(`${seed}:vx`) * 160, -110 - randomFor(`${seed}:vy`) * 90, 0)
        sprite.material.rotation = Math.atan2(velocity.y, velocity.x)
        sprite.scale.set(46, 3.2, 1)
        sprite.raycast = () => {}
        background.add(sprite)
        meteors.push({ sprite, velocity, life: 0 })
        meteorTimer = 2.5 + randomFor(`${seed}:next`) * 4
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const meteor = meteors[i]
        meteor.life += dt
        meteor.sprite.position.addScaledVector(meteor.velocity, dt)
        meteor.sprite.material.opacity = Math.max(0, 1 - meteor.life / 1.5) * 0.95
        if (meteor.life >= 1.5) {
          background.remove(meteor.sprite)
          meteor.sprite.material.dispose()
          meteors.splice(i, 1)
        }
      }
    }

    let frame = 0
    let last = performance.now()
    function updateOrbit() {
      if (!orbit) return
      for (const item of orbit.items) {
        const c = Math.cos(item.theta)
        const s = Math.sin(item.theta)
        item.node.x = item.node.fx = orbit.center.x + item.radius * (c * item.u.x + s * item.v.x)
        item.node.y = item.node.fy = orbit.center.y + item.radius * (c * item.u.y + s * item.v.y)
        item.node.z = item.node.fz = orbit.center.z + item.radius * (c * item.u.z + s * item.v.z)
        item.node.__threeObj?.position.set(item.node.x, item.node.y, item.node.z)
      }
      for (const edge of orbit.edges) {
        const source = graph.nodeByKey.get(endpointKey(edge.source))!
        const target = graph.nodeByKey.get(endpointKey(edge.target))!
        const attribute = edge.__lineObj?.geometry.getAttribute('position')
        if (!attribute) continue
        attribute.setXYZ(0, source.x, source.y, source.z)
        attribute.setXYZ(1, target.x, target.y, target.z)
        attribute.needsUpdate = true
      }
    }
    function animate() {
      if (disposed) return
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!document.hidden) {
        clock += dt
        updateMeteors(dt)
        // Let the pointer catch a moving planet instead of chasing it while clicking.
        if (orbit && hovered?.rootId !== focused) {
          for (const item of orbit.items) item.theta += item.speed * dt
          updateOrbit()
        }
        if (controls?.target && !dragging && now >= cameraBusyUntil) {
          if (lookTarget) controls.target.lerp(lookTarget, Math.min(1, dt * 12))
          else if (!selected && !focused && ready && now - idleSince > 1800) {
            const dx = camera.position.x - center.x
            const dz = camera.position.z - center.z
            const angle = dt * 0.06
            camera.position.x = center.x + dx * Math.cos(angle) - dz * Math.sin(angle)
            camera.position.z = center.z + dx * Math.sin(angle) + dz * Math.cos(angle)
            controls.target.lerp(center, Math.min(1, dt))
          }
        }
        if (clock - lastPulse >= 1 / 30) {
          const effectDt = clock - lastPulse
          lastPulse = clock
          for (const object of pulses) {
            const pulse = object.userData.pulse
            const scale = pulse.base * (1 + pulse.amp * Math.sin(clock * 1.8 + pulse.phase))
            object.scale.set(scale, scale, 1)
          }
          for (const object of spins) {
            const speed = object.userData.spin * 60 * effectDt
            object.rotation.y += speed
            object.rotation.x += speed * 0.45
          }
          background.rotation.y += effectDt * 0.006
        }
        if (clock - lastBreathing >= 1 / 12) {
          lastBreathing = clock
          if (selected) {
            for (const [index, edge] of chain.entries()) {
              const material = edge.__lineObj?.material as THREE.LineBasicMaterial | undefined
              if (!material) continue
              const fraction = THREE.MathUtils.clamp((clock - chainStart - index * 0.07) / 0.4, 0, 1)
              material.opacity = 0.22 + 0.48 * fraction
            }
          }
          else for (const edge of graph.links as RenderLink[]) {
            if (edge.kind !== 'rel') continue
            const material = edge.__lineObj?.material as THREE.LineBasicMaterial | undefined
            if (material) material.opacity = edge.baseAlpha * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(clock * 0.7 + edge.phase)))
          }
        }
      }
      frame = requestAnimationFrame(animate)
    }
    if (pendingReady.current === graph) layoutReady()
    animate()
    const onVisibility = () => {
      last = performance.now()
      idleSince = last
      if (document.hidden) fg.pauseAnimation()
      else fg.resumeAnimation()
    }
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()

    return () => {
      disposed = true
      runtimeRef.current = null
      cancelAnimationFrame(frame)
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      controls?.removeEventListener('start', onStart)
      controls?.removeEventListener('end', onEnd)
      if (bloom) { composer?.removePass(bloom); bloom.dispose() }
      scene.remove(background)
      background.traverse((object: any) => {
        object.geometry?.dispose()
        if (object.material) object.material.dispose()
      })
      nebulaTextures.forEach((texture) => texture.dispose())
      meteorTexture.dispose()
      // ForceGraph owns its node/link objects and disposes their geometry, materials and textures on unmount.
      // Release the browser's GPU context after a real unmount; StrictMode's immediate remount retains it.
      queueMicrotask(() => { if (!runtimeRef.current) renderer.forceContextLoss() })
    }
  }, [graph])

  return <div className="graph-layer">
    <ForceGraph3D ref={graphRef} graphData={graph} width={size.width} height={size.height}
      backgroundColor="#05060f" showNavInfo={false}
      warmupTicks={120} cooldownTicks={1} cooldownTime={1000}
      enableNodeDrag={false}
      nodeThreeObject={nodeObject} nodeThreeObjectExtend={false}
      linkColor={linkColor} linkMaterial={linkMaterial} linkDirectionalParticles={relationParticles}
      linkDirectionalParticleWidth={1.4} linkDirectionalParticleSpeed={0.011}
      onEngineStop={onEngineStop} onNodeHover={onHover} onNodeClick={onNodeClick} onBackgroundClick={onBackgroundClick}
    />
  </div>
}

export default memo(StarMap)
