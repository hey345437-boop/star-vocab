# Phase 3 Batched Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 2 ForceGraph rendering path with a batched Three.js WebGL2 renderer while preserving every overview, sector, root, word, portal, progress, fallback, and readiness behavior.

**Architecture:** Phase 3A consumes the immutable Phase 2 `SceneSnapshot` contract and compiles it into dense GPU arrays plus frozen CPU sidecars. `BatchedStarRenderer` implements the existing `GraphRenderer` interface, owns one `FrameScheduler`, one WebGL context, transactional staging resources, GPU ID picking, a Canvas2D label overlay, postprocessing, and the shared five-state quality controller. Phase 3B is a separate release operation that removes Legacy only after the evidence gate in Task 15 passes.

**Tech Stack:** React 18, TypeScript, Zustand, Three.js 0.184.x, WebGL2, Three.js postprocessing, Vitest, Playwright, Chrome DevTools Protocol, Vite production builds.

---

## Execution Rules

- Execute Tasks 0-14 for Phase 3A in order. Task 0 is a hard stop: do not change Phase 3 code until every Phase 2 gate passes.
- Keep `LegacyForceGraphRenderer` as the default through Task 13. Use `?renderer=batched` for development and production-build acceptance until Task 14 changes the default.
- Do not execute Tasks 15-17 during the initial Phase 3A implementation. They require two consecutive stable releases spanning at least 14 natural days.
- Use only exact `git add` paths shown below. Never run `git add .`, `git add -A`, or stage `.serena/`.
- Run browser, visual, and network gates against `npm run build` output served by `tests/helpers/static-server.mjs`. Run performance gates through `playwright.perf.config.ts`, whose production server is `scripts/perf-server.mjs`, and run bundle gates with `scripts/check-bundle.mjs`; never score the Vite development server.
- Keep `star-vocab-progress-v1` and its `Record<string, Progress>` payload unchanged.
- Never let the renderer import React, Zustand, `CatalogRepository`, or sharded data types. It receives only `SceneSnapshot`, `ScenePatch`, `RendererCommand`, and callbacks from `src/render/contracts.ts`.

## Locked Phase 2 Handoff

Phase 3 must consume these Phase 2 definitions from `src/render/contracts.ts`; it must not introduce a second scene model:

```ts
export type SceneNodeKind =
  | 'sector'
  | 'sector-portal'
  | 'root'
  | 'root-portal'
  | 'word'

export type SceneEdgeKind = 'overview' | 'member' | 'word-relation'

export interface RootPortalSidecar {
  readonly kind: 'root'
  readonly target: { readonly kind: 'root'; readonly rootId: string }
  readonly relationIds: readonly string[]
  readonly remoteWordIds: readonly string[]
  readonly contributingLocalRootIds: readonly string[]
}

export interface SceneSnapshot {
  readonly catalogVersion: string
  readonly layoutVersion: string
  readonly viewEpoch: number
  readonly target: ViewTarget
  readonly nodes: readonly SceneNode[]
  readonly edges: readonly SceneEdge[]
  readonly indexes: SceneIndexes
  readonly visibleCounts: VisibleCounts
  readonly sidecars: {
    readonly portals: Readonly<Record<PortalKey, SectorPortalSidecar | RootPortalSidecar>>
    readonly wordCards: Readonly<Record<WordKey, WordCardSnapshot>>
  }
}
```

For every root portal, `relationIds` and `remoteWordIds` have the same length and corresponding indexes, sorted by relation ID. `contributingLocalRootIds` is independently deduplicated and sorted. All sidecar records and nested values are deeply frozen before the renderer receives them.

## File Ownership

Create these Phase 3A production modules:

- `src/render/BatchedStarRenderer.ts`: public `GraphRenderer` implementation and lifecycle boundary.
- `src/render/batched/compiledScene.ts`: GPU encodings and `CompiledScene` types.
- `src/render/batched/SceneCompiler.ts`: pure `SceneSnapshot -> CompiledScene` compiler and validation.
- `src/render/batched/SceneGpuResources.ts`: one staged or committed scene's GPU ownership.
- `src/render/batched/SceneTransaction.ts`: latest-epoch staging, commit, rollback, and disposal serialization.
- `src/render/batched/gpu/nodePosition.ts`: texture packing, orbit basis math, CPU resolver, and shared GLSL resolver.
- `src/render/batched/gpu/stateTextures.ts`: coalesced local node/edge state texture updates.
- `src/render/batched/gpu/nodeBatches.ts`: core, additive halo/ring, and root wireframe batches.
- `src/render/batched/gpu/edgeBatches.ts`: member, overview/relation, and particle batches.
- `src/render/batched/gpu/backgroundBatches.ts`: deterministic stars, nebulae, and fixed-capacity meteors.
- `src/render/batched/PostProcessingPipeline.ts`: direct render or `RenderPass -> UnrealBloomPass -> OutputPass`.
- `src/render/batched/PickingPass.ts`: real 1x1 GPU ID pass and readback.
- `src/render/batched/pickingPolicy.ts`: hover throttling and click reuse pure policy.
- `src/render/batched/LabelOverlay.ts`: transparent Canvas2D overlay lifecycle and drawing.
- `src/render/batched/labelPolicy.ts`: deterministic priority and quota selection.
- `src/render/batched/CameraController.ts`: drag/zoom, camera flight, idle rotation, and reduced-motion behavior.
- `src/render/batched/ContextLifecycle.ts`: context loss, one restore attempt, and fatal notification.

Reuse, rather than fork, these Phase 1 modules:

- `src/render/contracts.ts`
- `src/render/FrameScheduler.ts`
- `src/render/qualityController.ts`
- `src/render/resourceRegistry.ts`
- `src/perf/testApi.ts`
- `src/scene/SceneCoordinator.ts`
- `src/components/StaticCatalogView.tsx`

### Task 0: Verify The Phase 2 Release Gate

**Files:**
- Inspect: `src/render/contracts.ts`
- Inspect: `src/scene/SceneCoordinator.ts`
- Inspect: `src/data/CatalogRepository.ts`
- Inspect: `tests/fixtures/catalogFactory.ts`
- Inspect: `test-results/`

- [ ] **Step 1: Verify all automated Phase 2 suites**

Run:

```bash
npm run test:unit
npm run test:integration
npm run test:browser
node scripts/check-bundle.mjs --phase=2
```

Expected: every command exits `0`; the browser report contains passing direct overview, sector entry/exit, sector portal, root portal, static fallback, and `fallback-ready` cases.

- [ ] **Step 2: Verify the fixed D1, D2, and D3 Phase 2 matrix**

Run on the configured environments:

```bash
npm run build:benchmark
npm run perf:precompress
npm run perf:phase2 -- --project=D1 --project=D2
npm run perf:phase2:d3
npm run verify:phase2-release
```

Expected: every command exits `0`; `perf:phase2:d3` is the only path that invokes D3 and its preflight proves a real Pixel 7a rather than desktop emulation or SwiftShader. The final verifier checks the signed D1/D2/D3, bundle, rollback, and deployed-origin artifacts belong to this exact Phase 2 candidate. A direct desktop `--project=D3` invocation is never accepted as evidence.

- [ ] **Step 3: Verify the renderer-neutral snapshot contract**

Run:

```bash
npx vitest run tests/unit/sceneSnapshot.test.ts tests/unit/sceneProjection.test.ts tests/integration/rendererContract.test.ts
```

Expected: `PASS`; the tests cover all five node kinds, all three edge kinds, frozen `portals` and `wordCards`, deterministic root portal aggregation, and exact `visibleCounts`.

- [ ] **Step 4: Verify one Three.js runtime before adding Batched**

Run:

```bash
npm ls three --all
```

Expected: one deduplicated Three.js 0.184.x runtime and no invalid peer dependency. If 0.169.x and 0.184.x both appear, return to Phase 1 and fix that gate before continuing.

- [ ] **Step 5: Confirm the worktree boundary**

Run:

```bash
git status --short --branch
```

Expected: the Phase 2 implementation is committed, while its signed environment reports and rollback evidence are available in the reviewed release-artifact system rather than committed under `test-results/`. The Phase 2 release verifier must reference those artifact digests and exit 0. An untracked `.serena/` entry is allowed and remains untouched. Do not create a Phase 3 commit for this task.

### Task 1: Compile SceneSnapshot Into Dense GPU Data

**Files:**
- Create: `src/render/batched/compiledScene.ts`
- Create: `src/render/batched/SceneCompiler.ts`
- Create: `tests/fixtures/batchedSceneFactory.ts`
- Create: `tests/unit/render/SceneCompiler.test.ts`

- [ ] **Step 1: Add the RED compiler contract tests**

Keep the locked Phase 2 `SceneFixtureName` union unchanged. In `batchedSceneFactory.ts`, project existing Phase 2 catalog fixtures and the existing two-root portal input; expose exactly:

```ts
import type { SceneSnapshot } from '../../src/render/contracts'
import { projectCatalogScene } from '../../src/scene/projectCatalogScene'
import {
  createCatalogFixture,
  createProjectionInput,
  createTwoRootPortalProjectionInput,
} from './catalogFactory'

export function createBatchedContractScenes(): readonly [
  SceneSnapshot,
  SceneSnapshot,
  SceneSnapshot,
  SceneSnapshot,
] {
  const overviewFixture = createCatalogFixture('CAT10K')
  const lodFixture = createCatalogFixture('LOD_MAX')
  const sectorId = Object.keys(lodFixture.layoutLock.sectors).sort()[0]
  if (!sectorId) throw new Error('LOD_MAX must contain a sector')
  const rootId = lodFixture.layoutLock.sectors[sectorId]?.rootIds[0]
  if (!rootId) throw new Error('LOD_MAX must contain a root')

  const scenes: [SceneSnapshot, SceneSnapshot, SceneSnapshot, SceneSnapshot] = [
    projectCatalogScene(createProjectionInput(overviewFixture, { kind: 'overview' })),
    projectCatalogScene(createProjectionInput(lodFixture, { kind: 'sector', sectorId })),
    projectCatalogScene(createProjectionInput(lodFixture, { kind: 'root', rootId })),
    projectCatalogScene(createTwoRootPortalProjectionInput()),
  ]
  return Object.freeze(scenes)
}
```

The four snapshots supply sector overview, sector portals, bounded root/word LOD, and global root-portal aggregation without adding another fixture name. Add tests equivalent to:

```ts
import { describe, expect, it } from 'vitest'
import { createBatchedContractScenes } from '../../fixtures/batchedSceneFactory'
import { compileScene, GPU_EDGE_KIND, GPU_NODE_KIND } from '../../../src/render/batched/SceneCompiler'

describe('compileScene', () => {
  it('encodes every Phase 2 node and edge kind', () => {
    const compiled = createBatchedContractScenes().map(compileScene)

    expect([...new Set(compiled.flatMap((scene) => [...scene.kinds]))].sort((a, b) => a - b)).toEqual([
      GPU_NODE_KIND.sector,
      GPU_NODE_KIND.root,
      GPU_NODE_KIND.word,
      GPU_NODE_KIND['sector-portal'],
      GPU_NODE_KIND['root-portal'],
    ])
    expect([...new Set(compiled.flatMap((scene) => [...scene.edgeKinds]))].sort((a, b) => a - b)).toEqual([
      GPU_EDGE_KIND.overview,
      GPU_EDGE_KIND.member,
      GPU_EDGE_KIND['word-relation'],
    ])
  })

  it('keeps each root immediately followed by its stable word order', () => {
    const [, , scene] = createBatchedContractScenes()
    const compiled = compileScene(scene)
    const rootNode = scene.nodes.find((node) => node.kind === 'root')
    if (!rootNode) throw new Error('expected root node')
    const root = compiled.sidecar.nodeKeys.indexOf(rootNode.key)
    const wordKeys = scene.nodes
      .filter((node) => node.kind === 'word' && node.rootId === rootNode.rootId)
      .map((node) => node.key)
      .sort()
    expect(compiled.sidecar.nodeKeys.slice(root, root + 1 + wordKeys.length)).toEqual([
      rootNode.key,
      ...wordKeys,
    ])
    expect([...compiled.parentIndices.slice(root + 1, root + 1 + wordKeys.length)])
      .toEqual(wordKeys.map(() => root))
  })

  it('keeps portal navigation and word cards on the CPU', () => {
    const [, , , scene] = createBatchedContractScenes()
    const compiled = compileScene(scene)
    const portal = compiled.sidecar.portals['portal:root:remote-root']

    expect(portal).toMatchObject({
      kind: 'root',
      target: { kind: 'root', rootId: 'remote-root' },
      contributingLocalRootIds: ['local-a', 'local-b'],
    })
    if (portal.kind !== 'root') throw new Error('expected root portal')
    expect(portal.relationIds).toEqual([...portal.relationIds].sort())
    expect(portal.remoteWordIds).toHaveLength(portal.relationIds.length)
    const wordKey = scene.nodes.find((node) => node.kind === 'word')?.key
    if (!wordKey) throw new Error('expected word node')
    expect(compiled.sidecar.wordCards[wordKey]).toBe(scene.sidecars.wordCards[wordKey])
    expect(JSON.stringify(compiled.gpuPayload)).not.toContain(portal.remoteWordIds[0])
  })
})
```

- [ ] **Step 2: Run the compiler test and verify RED**

Run:

```bash
npm run test:unit -- tests/unit/render/SceneCompiler.test.ts
```

Expected: `FAIL` because `src/render/batched/SceneCompiler.ts` does not exist.

- [ ] **Step 3: Define the exact compiled representation**

Create `compiledScene.ts` with these fields and no Three.js imports:

```ts
import type { SceneSnapshot, VisibleCounts } from '../contracts'

export interface CompiledScene {
  readonly catalogVersion: string
  readonly layoutVersion: string
  readonly viewEpoch: number
  readonly visibleCounts: VisibleCounts
  readonly positions: Float32Array
  readonly colors: Uint8Array
  readonly sizes: Float32Array
  readonly kinds: Uint8Array
  readonly parentIndices: Int32Array
  readonly mastery: Uint8Array
  readonly nodeFlags: Uint16Array
  readonly orbitBasisU: Float32Array
  readonly orbitBasisV: Float32Array
  readonly orbitParams: Float32Array
  readonly endpoints: Uint32Array
  readonly edgeKinds: Uint8Array
  readonly relTypes: Uint8Array
  readonly edgeColors: Uint8Array
  readonly edgePhases: Float32Array
  readonly edgeOffsets: Uint32Array
  readonly edgeIndices: Uint32Array
  readonly gpuPayload: readonly ArrayBufferView[]
  readonly sidecar: {
    readonly nodeKeys: readonly string[]
    readonly labels: readonly string[]
    readonly sublabels: readonly (string | null)[]
    readonly indexByKey: ReadonlyMap<string, number>
    readonly portals: SceneSnapshot['sidecars']['portals']
    readonly wordCards: SceneSnapshot['sidecars']['wordCards']
  }
}
```

Use four floats per node in both orbit arrays: `orbitBasisU=[ux,uy,uz,radius]`, `orbitBasisV=[vx,vy,vz,phase]`, and `orbitParams=[angularVelocity,motionEnabled,0,0]`.

- [ ] **Step 4: Implement deterministic encoding and validation**

Create `SceneCompiler.ts` with stable numeric maps:

```ts
export const GPU_NODE_KIND = Object.freeze({
  sector: 0,
  root: 1,
  word: 2,
  'sector-portal': 3,
  'root-portal': 4,
} as const)

export const GPU_EDGE_KIND = Object.freeze({
  overview: 0,
  member: 1,
  'word-relation': 2,
} as const)

export function compileScene(scene: SceneSnapshot): CompiledScene {
  assertSnapshotIsDeeplyFrozen(scene)
  const orderedNodes = orderNodesByRoot(scene.nodes)
  const indexByKey = indexUniqueKeys(orderedNodes)
  validatePortalSidecars(scene.sidecars.portals)
  validateEdges(scene.edges, indexByKey)
  return encodeCompiledScene(scene, orderedNodes, indexByKey)
}
```

`orderNodesByRoot` uses this order: sectors by key, sector portals by key, root groups by root key with that root's words by key immediately after it, then root portals by key. Reject duplicate keys, orphan words, null/non-finite Phase 2 positions, dangling edge endpoints, sidecar keys without matching portal/word nodes, mismatched root portal relation arrays, and `visibleCounts` that differ from the encoded arrays. Build CSR in two passes so `edgeOffsets.length === nodeCount + 1` and `edgeIndices.length === edgeCount * 2`.

- [ ] **Step 5: Verify compiler GREEN and maximum fixtures**

Run:

```bash
npm run test:unit -- tests/unit/render/SceneCompiler.test.ts
npx vitest run tests/unit/sceneProjection.test.ts
```

Expected: `PASS`; `LOD_MAX` compiles 200 roots, 32 sector portals, 64 root portals, 600 words, 600 member edges, 2,400 word-relation edges, and 600 overview edges without runtime clipping. `GPU10K` compiles 10,000 nodes, 30,000 edges, and a degree-500 hub.

- [ ] **Step 6: Commit the compiler**

```bash
git add src/render/batched/compiledScene.ts src/render/batched/SceneCompiler.ts tests/fixtures/batchedSceneFactory.ts tests/unit/render/SceneCompiler.test.ts
git commit -m "feat: compile scene snapshots into gpu arrays"
```

### Task 2: Build Shared Position And State Textures

**Files:**
- Create: `src/render/batched/gpu/nodePosition.ts`
- Create: `src/render/batched/gpu/stateTextures.ts`
- Create: `tests/unit/render/nodePosition.test.ts`
- Create: `tests/unit/render/stateTextures.test.ts`

- [ ] **Step 1: Add RED texture layout and orbit tests**

Test exact texture dimensions, the locked Phase 2 orbit formula, reduced motion, and indexes crossing a texture row:

```ts
it('packs GPU10K within the reported texture limit', () => {
  expect(textureDimensions(10_000, 4_096)).toEqual({ width: 4_096, height: 3 })
  expect(textureCoordinate(4_096, 4_096)).toEqual({ x: 0, y: 1 })
})

it('resolves the same locked orbit on CPU', () => {
  const result = resolveNodePositionCpu(compiled, wordIndex, 2.5, true)
  const frozen = resolveNodePositionCpu(compiled, wordIndex, 2.5, false)
  for (let axis = 0; axis < 3; axis += 1) {
    expect(result[axis]).toBeCloseTo(expectedOrbitPosition[axis], 5)
    expect(frozen[axis]).toBeCloseTo(expectedPhaseZeroPosition[axis], 5)
  }
})
```

For inclination `i` and ascending node `omega`, assert `u=(cos(omega),sin(omega),0)` and `v=(-sin(omega)*cos(i),cos(omega)*cos(i),sin(i))`.

- [ ] **Step 2: Run position tests and verify RED**

Run:

```bash
npm run test:unit -- tests/unit/render/nodePosition.test.ts tests/unit/render/stateTextures.test.ts
```

Expected: `FAIL` because both GPU modules are missing.

- [ ] **Step 3: Implement the shared resolver and 2D packing**

Export one GLSL string used verbatim by node, edge, particle, and picking materials:

```ts
export const RESOLVE_NODE_POSITION_GLSL = /* glsl */ `
  ivec2 nodeTexel(float index, vec2 textureSize) {
    int i = int(index);
    int width = int(textureSize.x);
    return ivec2(i % width, i / width);
  }

  vec3 resolveNodePosition(float index, float time) {
    ivec2 uv = nodeTexel(index, uNodeTextureSize);
    vec4 base = texelFetch(uPositionTexture, uv, 0);
    vec4 basisU = texelFetch(uOrbitUTexture, uv, 0);
    vec4 basisV = texelFetch(uOrbitVTexture, uv, 0);
    vec4 motion = texelFetch(uOrbitMotionTexture, uv, 0);
    if (base.w < 0.5 || motion.y < 0.5 || uReducedMotion) return base.xyz;
    int parentIndex = int(base.w) - 1;
    vec3 center = texelFetch(uPositionTexture, nodeTexel(float(parentIndex), uNodeTextureSize), 0).xyz;
    float theta = basisV.w + time * motion.x;
    return center + basisU.w * (basisU.xyz * cos(theta) + basisV.xyz * sin(theta));
  }
`
```

Store `parentIndex + 1` in position alpha and `0` for no parent. When reduced motion is active, populate the base word position with the locked phase position so CPU labels and GPU nodes freeze at the same point.

- [ ] **Step 4: Implement coalesced local state updates**

`stateTextures.ts` owns one RGBA8 node-state texture and one RGBA8 edge-state texture. Encode mastery, low/high flag bytes, and relation-chain state. Queue dirty dense indexes in sets, sort them, coalesce adjacent indexes without crossing texture rows, and upload only those rectangles through one reusable patch texture plus `WebGLRenderer.copyTextureToTexture`. `setGlobalLocked` changes a uniform and must not enqueue any node index.

Expose metrics used by tests:

```ts
export interface StateTextureMetrics {
  readonly nodePatchedTexels: number
  readonly edgePatchedTexels: number
  readonly fullTextureUploads: number
}
```

- [ ] **Step 5: Verify local updates and no full-scene lock upload**

Run:

```bash
npm run test:unit -- tests/unit/render/nodePosition.test.ts tests/unit/render/stateTextures.test.ts
```

Expected: `PASS`; changing one word and three incident edges patches four texels, a row boundary produces two rectangles, and global lock changes `fullTextureUploads` by zero.

- [ ] **Step 6: Commit shared GPU textures**

```bash
git add src/render/batched/gpu/nodePosition.ts src/render/batched/gpu/stateTextures.ts tests/unit/render/nodePosition.test.ts tests/unit/render/stateTextures.test.ts
git commit -m "feat: add shared gpu scene textures"
```

### Task 3: Batch Nodes And Background Effects

**Files:**
- Create: `src/render/batched/gpu/nodeBatches.ts`
- Create: `src/render/batched/gpu/backgroundBatches.ts`
- Create: `tests/unit/render/nodeBatches.test.ts`
- Create: `tests/unit/render/backgroundBatches.test.ts`

- [ ] **Step 1: Add RED batch ownership tests**

Assert one instanced core batch for all five node kinds, one additive halo/core/ring batch, one root-only wireframe `InstancedMesh`, one material per batch, deterministic background buffers, and idempotent disposal:

```ts
const batches = createNodeBatches(compiled, textures)
expect(batches.metrics).toEqual({ coreBatches: 1, additiveBatches: 1, rootWireframeBatches: 1 })
expect(batches.core.count).toBe(compiled.kinds.length)
expect(batches.rootWireframe.count).toBe(countKind(compiled, GPU_NODE_KIND.root))
```

- [ ] **Step 2: Run batch tests and verify RED**

Run:

```bash
npm run test:unit -- tests/unit/render/nodeBatches.test.ts tests/unit/render/backgroundBatches.test.ts
```

Expected: `FAIL` because the batch factories do not exist.

- [ ] **Step 3: Implement the node batches**

Use one six-vertex instanced billboard geometry with `aNodeIndex`. The vertex shader calls `resolveNodePosition`; the fragment shader renders SDF variants selected by `kinds`: solid sector, root star, word star, sector-portal ring, and root-portal ring. The picking radius is not used in the visual materials. Selected, hover, relation-neighbor, mastery, and lock state come from the node-state texture and global uniforms.

The additive batch renders halo, bright core, and selected ring in one material. The root wireframe batch contains roots only and uses one shared low-poly wireframe geometry and material.

- [ ] **Step 4: Implement deterministic background batches**

Create exactly one `Points` background-star batch, one instanced nebula billboard batch, and one fixed-capacity meteor batch. Seed positions and phases from `catalogVersion + layoutVersion`; never call `Math.random`. Reuse slots in a ring buffer and update only the reused instance range.

`prefers-reduced-motion` hides meteors, freezes node-core breathing, and freezes background rotation without disposing or recreating geometry.

- [ ] **Step 5: Verify batch counts and disposal**

Run:

```bash
npm run test:unit -- tests/unit/render/nodeBatches.test.ts tests/unit/render/backgroundBatches.test.ts
npm run build
```

Expected: tests and build pass; calling each `dispose()` twice leaves registered geometry, material, and texture ownership at zero without throwing.

- [ ] **Step 6: Commit node and background batches**

```bash
git add src/render/batched/gpu/nodeBatches.ts src/render/batched/gpu/backgroundBatches.ts tests/unit/render/nodeBatches.test.ts tests/unit/render/backgroundBatches.test.ts
git commit -m "feat: render star nodes in gpu batches"
```

### Task 4: Batch Edges, Relation Particles, And Orbit Motion

**Files:**
- Create: `src/render/batched/gpu/edgeBatches.ts`
- Create: `tests/unit/render/edgeBatches.test.ts`

- [ ] **Step 1: Add RED edge topology tests**

Cover member edges, overview edges between sectors/roots/sector portals, word relations ending at a real word or root portal, relation type colors, phases, the degree-500 hub, and selection updates through CSR:

```ts
const batches = createEdgeBatches(compiled, textures)
expect(batches.metrics).toEqual({ memberBatches: 1, semanticEdgeBatches: 1, particleBatches: 1 })
expect(batches.semantic.geometry.getAttribute('aEndpointIndex').count).toBe(
  2 * (compiled.visibleCounts.wordRelationEdges + compiled.visibleCounts.overviewEdges),
)
```

- [ ] **Step 2: Run edge tests and verify RED**

Run:

```bash
npm run test:unit -- tests/unit/render/edgeBatches.test.ts
```

Expected: `FAIL` because `edgeBatches.ts` is missing.

- [ ] **Step 3: Implement three edge draw batches**

Create:

```ts
export interface EdgeBatches {
  readonly member: THREE.LineSegments
  readonly semantic: THREE.LineSegments
  readonly particles: THREE.Points
  applyChain(selectedNodeIndex: number | null): readonly number[]
  setParticlesEnabled(enabled: boolean): void
  dispose(): void
}
```

Each line vertex stores a dense node index and calls the shared GLSL resolver. The semantic fragment shader distinguishes overview and word-relation appearance with `edgeKinds`, applies relation color and phase breathing, and accepts portal endpoints without a node-kind assumption. Particle points store edge index and interpolation phase; the vertex shader resolves both endpoints and interpolates on the GPU. Selection uses CSR to patch only incident edge-state texels. Reduced motion sets orbit and breathing uniforms to zero and hides moving relation particles without rebuilding a batch.

- [ ] **Step 4: Verify portal endpoints and no CPU endpoint rewrite**

Run:

```bash
npm run test:unit -- tests/unit/render/edgeBatches.test.ts tests/unit/render/nodePosition.test.ts
```

Expected: `PASS`; advancing orbit time changes the CPU reference positions but leaves edge geometry attributes and upload metrics unchanged. A word-to-root-portal relation produces one semantic line and retains its canonical relation ID only in CPU metadata.

- [ ] **Step 5: Commit edge and particle batches**

```bash
git add src/render/batched/gpu/edgeBatches.ts tests/unit/render/edgeBatches.test.ts
git commit -m "feat: batch graph edges and orbit animation"
```

### Task 5: Add 1x1 GPU Picking

**Files:**
- Create: `src/render/batched/pickingPolicy.ts`
- Create: `src/render/batched/PickingPass.ts`
- Create: `tests/unit/render/pickingPolicy.test.ts`
- Create: `tests/unit/render/PickingPass.test.ts`

- [ ] **Step 1: Add RED policy and ID codec tests**

Test RGB round trips through ID `16_777_215`, zero as background, 30 Hz hover throttling, the 2 CSS px movement threshold, drag pause, forced click, and 50 ms same-coordinate reuse:

```ts
expect(decodePickId(encodePickId(1))).toBe(1)
expect(decodePickId(encodePickId(25_000))).toBe(25_000)
const policy = new PickingPolicy()
policy.recordHover({ x: 10, y: 10 }, 0, 17)
expect(policy.shouldHover({ x: 10, y: 10 }, 32)).toBe(false)
expect(policy.shouldHover({ x: 13, y: 10 }, 34)).toBe(true)
policy.recordHover({ x: 13, y: 10 }, 34, 23)
expect(policy.canReuseClick({ x: 13, y: 10 }, 83)).toBe(true)
expect(policy.canReuseClick({ x: 13, y: 10 }, 85)).toBe(false)
```

- [ ] **Step 2: Run picking tests and verify RED**

Run:

```bash
npm run test:unit -- tests/unit/render/pickingPolicy.test.ts tests/unit/render/PickingPass.test.ts
```

Expected: `FAIL` because picking modules are absent.

- [ ] **Step 3: Implement the real 1x1 pass**

Create one `WebGLRenderTarget(1, 1)` and a picking scene that shares node geometry but owns its ID material. Encode `denseNodeIndex + 1` into RGB. Convert CSS coordinates using the canvas bounding rect and actual drawing buffer dimensions, clone the camera, and call:

```ts
pickCamera.setViewOffset(
  drawingBufferWidth,
  drawingBufferHeight,
  drawingX,
  drawingY,
  1,
  1,
)
```

Compute `drawingX=floor((clientX-rect.left)*drawingBufferWidth/rect.width)` and the equivalent top-origin `drawingY`, clamp both to the buffer, render one pixel, and call `readRenderTargetPixels(target, 0, 0, 1, 1, bytes)`. Map the decoded dense index through `compiled.sidecar.nodeKeys`. In the picking vertex shader enforce minimum radii of 12 px for words, 18 px for roots and both portal kinds, and 22 px for sectors.

- [ ] **Step 4: Verify policies and lifecycle**

Run:

```bash
npm run test:unit -- tests/unit/render/pickingPolicy.test.ts tests/unit/render/PickingPass.test.ts
```

Expected: `PASS`; disposal releases the render target and picking material once, and a background read returns `null`.

- [ ] **Step 5: Commit GPU picking**

```bash
git add src/render/batched/pickingPolicy.ts src/render/batched/PickingPass.ts tests/unit/render/pickingPolicy.test.ts tests/unit/render/PickingPass.test.ts
git commit -m "feat: add gpu node picking"
```

### Task 6: Add Canvas Labels And Camera Control

**Files:**
- Create: `src/render/batched/labelPolicy.ts`
- Create: `src/render/batched/LabelOverlay.ts`
- Create: `src/render/batched/CameraController.ts`
- Create: `tests/unit/render/labelPolicy.test.ts`
- Create: `tests/unit/render/CameraController.test.ts`

- [ ] **Step 1: Add RED label priority and quota tests**

Assert this total order with stable-key tie breaking: selected, hover, current sector/focused root, navigation portal, relation neighbor, ordinary root, ordinary word. Assert desktop quota 80 and mobile quota 40, with selected and hover retained beyond the ordinary quota and deduplicated when they refer to the same node. Treat the viewport as mobile when CSS width is below 768 px or `matchMedia('(pointer: coarse)')` matches, so the 915x412 Pixel 7a landscape profile still uses 40.

- [ ] **Step 2: Add RED camera behavior tests**

Use a fake clock and camera to assert 900 ms deterministic flight, immediate reduced-motion positioning, drag start stopping idle rotation, 1.2 seconds before idle rotation resumes, background intent, and root/word/portal target centering.

- [ ] **Step 3: Run label and camera tests and verify RED**

Run:

```bash
npm run test:unit -- tests/unit/render/labelPolicy.test.ts tests/unit/render/CameraController.test.ts
```

Expected: `FAIL` because the policy, overlay, and controller do not exist.

- [ ] **Step 4: Implement deterministic label selection and drawing**

Create a transparent, `pointer-events: none` Canvas2D overlay. Select candidates only on semantic state changes. During camera motion, project and redraw selected candidates at no more than 30 Hz; while stationary, redraw only after state, resize, or scene changes. Use `resolveNodePositionCpu` for moving words. Size its drawing buffer from the same actual DPR applied to WebGL.

Expose:

```ts
export interface LabelOverlayMetrics {
  readonly visibleLabels: number
  readonly drawCount: number
  readonly lastDrawAt: number
}
```

- [ ] **Step 5: Implement camera control without another rAF**

Use Three.js `TrackballControls`, but call `controls.update()` only from the shared `FrameScheduler`. `CameraController.update(time, delta)` owns flight interpolation and idle rotation. It emits drag state to `PickingPass`, and it never creates `requestAnimationFrame`, timers, or Store subscriptions.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test:unit -- tests/unit/render/labelPolicy.test.ts tests/unit/render/CameraController.test.ts tests/unit/render/nodePosition.test.ts
```

Expected: `PASS`; mobile and desktop quotas are exact, portal labels receive navigation priority, and camera tests report zero owned rAF callbacks.

- [ ] **Step 7: Commit labels and camera**

```bash
git add src/render/batched/labelPolicy.ts src/render/batched/LabelOverlay.ts src/render/batched/CameraController.ts tests/unit/render/labelPolicy.test.ts tests/unit/render/CameraController.test.ts
git commit -m "feat: add batched labels and camera controls"
```

### Task 7: Integrate Quality States And Postprocessing

**Files:**
- Create: `src/render/batched/PostProcessingPipeline.ts`
- Create: `tests/integration/render/BatchedQualityIntegration.test.ts`
- Inspect: `tests/unit/qualityController.test.ts`

- [ ] **Step 1: Re-run the shared quality boundary matrix**

Run:

```bash
npm run test:unit -- tests/unit/qualityController.test.ts
```

Expected: `PASS` for all five ordered states, high/balanced/low ceilings, strict 1.19/1.21 degradation boundaries, strict 0.81/0.79 recovery boundaries, 120/300 sample counts, no skipped states, and user-disabled Bloom staying disabled after recovery. If this fails, fix the shared Phase 1 controller before adding renderer integration.

- [ ] **Step 2: Add RED postprocessing integration tests**

Use fake renderer/composer adapters and assert this exact mapping:

```ts
const QUALITY = {
  high: { dpr: 1.75, particles: true, qualityAllowsBloom: true },
  balanced: { dpr: 1.25, particles: true, qualityAllowsBloom: true },
  low: { dpr: 1.0, particles: true, qualityAllowsBloom: true },
  'low-no-particles': { dpr: 1.0, particles: false, qualityAllowsBloom: true },
  minimal: { dpr: 1.0, particles: false, qualityAllowsBloom: false },
} as const
```

Assert actual DPR is `min(devicePixelRatio, preset.dpr)`, `userBloomEnabled && qualityAllowsBloom` controls Bloom, Bloom-off bypasses the composer, and particles are hidden without rebuilding edge geometry.

- [ ] **Step 3: Run integration test and verify RED**

Run:

```bash
npm run test:integration -- tests/integration/render/BatchedQualityIntegration.test.ts
```

Expected: `FAIL` because `PostProcessingPipeline.ts` is missing.

- [ ] **Step 4: Implement the owned postprocessing pipeline**

Create exactly one `EffectComposer`, one `RenderPass`, one `UnrealBloomPass`, and one `OutputPass`. When effective Bloom is false, call `renderer.render(scene, camera)` directly. Resize renderer, composer, Bloom, and label overlay together after applying actual DPR. Dispose passes and render targets exactly once.

- [ ] **Step 5: Verify quality integration GREEN**

Run:

```bash
npm run test:unit -- tests/unit/qualityController.test.ts
npm run test:integration -- tests/integration/render/BatchedQualityIntegration.test.ts
```

Expected: `PASS`; no sixth quality combination exists, and recovery never exceeds the selected ceiling.

- [ ] **Step 6: Commit postprocessing integration**

```bash
git add src/render/batched/PostProcessingPipeline.ts tests/integration/render/BatchedQualityIntegration.test.ts
git commit -m "feat: integrate batched quality and bloom"
```

### Task 8: Build Transactional GPU Scene Ownership

**Files:**
- Create: `src/render/batched/SceneGpuResources.ts`
- Create: `src/render/batched/SceneTransaction.ts`
- Create: `tests/integration/render/SceneTransaction.test.ts`
- Create: `tests/integration/render/SceneGpuResources.test.ts`

- [ ] **Step 1: Add RED transaction race tests**

Use fake staged resources and a controllable frame promise to assert:

- Load A stages without detaching the committed scene.
- Load B invalidates A; A rejects with `AbortError` and disposes only A staging resources.
- Load A finishes staging and waits on a held commit mutex; load B invalidates A before the mutex is released. When A finally enters the mutex, it rejects at the first stale check without reading `current`, attaching/detaching any live root, or submitting a business frame; the prior committed scene stays live and A staging disposes exactly once.
- A swap followed by abort before the first business frame restores the prior scene.
- Non-abort staging or first-frame failure keeps the prior scene.
- Old committed resources dispose only after the new epoch's first business frame.
- `dispose()` invalidates all tokens, waits for every load promise to settle, and then releases shared resources.

- [ ] **Step 2: Run transaction tests and verify RED**

Run:

```bash
npm run test:integration -- tests/integration/render/SceneTransaction.test.ts tests/integration/render/SceneGpuResources.test.ts
```

Expected: `FAIL` because both scene ownership modules are absent.

- [ ] **Step 3: Implement staged scene resources**

`SceneGpuResources.stage` compiles and uploads into detached visual and picking roots. It creates node, edge, background, state texture, and picking resources; calls `WebGLRenderer.compileAsync`; performs one 1x1 preflight render; and checks the signal between compilation, material compilation, upload, and preflight. It must not add either root to the live scene while staging.

Expose only:

```ts
export interface SceneGpuResources {
  readonly compiled: CompiledScene
  readonly visualRoot: THREE.Group
  readonly pickingRoot: THREE.Group
  applyPatch(patch: ScenePatch): void
  update(time: number, delta: number): void
  dispose(): void
}
```

- [ ] **Step 4: Implement a serialized atomic commit**

Use a private monotonically increasing load token and a commit mutex. The critical section is:

```ts
await commitMutex.runExclusive(async () => {
  let previous: SceneGpuResources | undefined
  let previousDetached = false
  let attached = false
  let committed = false

  try {
    assertLatest(token, signal)

    previous = current
    detach(previous)
    previousDetached = true

    attach(staging)
    attached = true

    await waitForBusinessFrame(scene.viewEpoch, scene.visibleCounts)
    assertLatest(token, signal)

    current = staging
    committed = true
    previousDetached = false
    previous?.dispose()
  } catch (error) {
    if (!committed) {
      if (attached) {
        detach(staging)
        attached = false
      }
      if (previousDetached) {
        attach(previous)
        previousDetached = false
      }
    }
    throw error
  } finally {
    if (!committed) {
      staging.dispose()
    }
  }
})
```

The commit closure becomes the sole owner of `staging` when it is handed to `runExclusive`; no outer rejection path may also dispose it. The first `assertLatest` stays inside the commit mutex and inside the ownership `try`, before reading `current`, detaching, attaching, or submitting a frame. Until `committed` becomes true, failures leave or restore the prior live scene: `attached` gates staging rollback, `previousDetached` gates prior-scene restoration, and the single `finally` disposes staging exactly once. The second `assertLatest` stays after the exact business frame and before publishing `current`; after publication, staging is the live owner and must not be disposed by this path.

In the mutex race test, hold the mutex, finish staging A, start B so that it invalidates A, then release the mutex. Assert that A rejects with `AbortError` on entering the critical section, `attach(A)` and the A business-frame submission are never called, the same prior scene remains current and attached, and `A.dispose()` is called exactly once. The business-frame waiter resolves only after a real renderer/composer submission carrying the exact epoch and counts. Never allow two staged roots to remain attached together.

- [ ] **Step 5: Verify race, rollback, and cleanup GREEN**

Run:

```bash
npm run test:integration -- tests/integration/render/SceneTransaction.test.ts tests/integration/render/SceneGpuResources.test.ts
```

Expected: `PASS`; all fake resources have exactly one terminal owner and no rejected promise is unhandled.

- [ ] **Step 6: Commit transactional resources**

```bash
git add src/render/batched/SceneGpuResources.ts src/render/batched/SceneTransaction.ts tests/integration/render/SceneTransaction.test.ts tests/integration/render/SceneGpuResources.test.ts
git commit -m "feat: stage and commit gpu scenes atomically"
```

### Task 9: Implement BatchedStarRenderer And Context Recovery

**Files:**
- Create: `src/render/batched/ContextLifecycle.ts`
- Create: `src/render/BatchedStarRenderer.ts`
- Create: `tests/integration/render/BatchedStarRenderer.test.ts`
- Create: `tests/unit/render/ContextLifecycle.test.ts`
- Modify: `tests/integration/rendererContract.test.ts`

- [ ] **Step 1: Add RED GraphRenderer contract tests**

Run the same renderer contract suite used by Legacy against a Batched factory. Assert mount once, latest-epoch `loadScene`, stale patch rejection, all commands, resize, frozen metrics snapshots, post-dispose method behavior, exact first-scene callback counts, `chain-start` after a committed chain frame, and one active FrameScheduler.

- [ ] **Step 2: Add RED context lifecycle tests**

Assert `webglcontextlost` calls `preventDefault`, pauses the scheduler, permits one restoration rebuild from the retained `CompiledScene`, resumes only after a valid business frame, and calls `onFatal` exactly once when the 5,000 ms restore deadline expires or shader/picking rebuild fails.

- [ ] **Step 3: Run renderer tests and verify RED**

Run:

```bash
npm run test:unit -- tests/unit/render/ContextLifecycle.test.ts
npm run test:integration -- tests/integration/render/BatchedStarRenderer.test.ts
```

Expected: `FAIL` because the renderer and context lifecycle are missing.

- [ ] **Step 4: Implement the public renderer lifecycle**

Use the existing contract without adding React or Store imports:

```ts
export class BatchedStarRenderer implements GraphRenderer {
  mount(host: HTMLElement, callbacks: RendererCallbacks): void
  loadScene(scene: SceneSnapshot, options: { signal: AbortSignal }): Promise<void>
  applyPatch(patch: ScenePatch): void
  execute(command: RendererCommand): void
  resize(width: number, height: number): void
  getMetrics(): RendererMetrics
  dispose(): Promise<void>
}
```

`mount` creates one WebGL canvas and one label canvas, requests `canvas.getContext('webgl2')`, and rejects initialization when that returns null. It then creates one Three WebGL renderer around that context, visual/picking scenes, camera, controls, postprocessing, picker, labels, context lifecycle, and the shared FrameScheduler. Pointer listeners live on the WebGL canvas. Node clicks map through CPU sidecars: sector and sector portal emit sector intents; root and root portal emit root intents; word emits word intent. Background click emits the semantic back/exit intent supplied by the current snapshot target.

- [ ] **Step 5: Implement patches, commands, and metrics**

Mastery patches update one node-state texel. Selection patches use CSR to update old/new node and edge flags, change global lock uniform, and schedule `chain-start` only after the first frame containing the new flags. Bloom and quality commands delegate to the shared controller and postprocessing pipeline. Navigation commands use `CameraController` and never mutate semantic Store state.

Return copied, frozen metrics containing renderer info, visible counts, force tick count `0`, quality ceiling/current state, actual DPR, effective Bloom/particles, active rAF/listener counts, and distinctly named `presentIntervalMs` and `rendererWorkMs` samples. Final disposal stops the scheduler, removes every listener and both canvases, disposes scene/shared/postprocessing resources and controls, calls `WebGLRenderer.dispose()` and `forceContextLoss()`, and only then resolves.

- [ ] **Step 6: Verify renderer and context GREEN**

Run:

```bash
npm run test:unit -- tests/unit/render/ContextLifecycle.test.ts
npx vitest run tests/integration/render/BatchedStarRenderer.test.ts tests/integration/rendererContract.test.ts
npm run build
```

Expected: `PASS`; Batched has one active rAF, zero D3 ticks, no React/Zustand/repository import, and every owned resource count reaches zero after disposal.

- [ ] **Step 7: Commit BatchedStarRenderer**

```bash
git add src/render/batched/ContextLifecycle.ts src/render/BatchedStarRenderer.ts tests/integration/render/BatchedStarRenderer.test.ts tests/unit/render/ContextLifecycle.test.ts tests/integration/rendererContract.test.ts
git commit -m "feat: implement batched star renderer"
```

### Task 10: Add Phase 3A Renderer Selection And Terminal Fallback

**Files:**
- Modify: `src/render/createRenderer.ts`
- Modify: `src/scene/SceneCoordinator.ts`
- Modify: `src/components/StarMap.tsx`
- Modify: `src/index.css`
- Modify: `src/perf/testApi.ts`
- Modify: `src/vite-env.d.ts`
- Create: `tests/unit/render/createRenderer.test.ts`
- Create: `tests/integration/scene/rendererFallback.test.ts`

- [ ] **Step 1: Add RED loader selection tests**

Cover `VITE_GRAPH_RENDERER=legacy|batched|auto`, `?renderer=legacy|batched`, invalid values, WebGL2 availability, and the absence of any static Legacy import on the batched path. Keep Legacy as the default result in this task.

- [ ] **Step 2: Add RED terminal recovery tests**

Inject loaders and failures to assert these exact paths:

```text
Batched mount/load/shader/picking/restore failure
  -> await Batched dispose
  -> mount Legacy once
  -> load the same latest valid SceneSnapshot and semantic target

Legacy mount/load/restore failure
  -> await Legacy dispose
  -> publish StaticCatalogSnapshot
  -> StaticCatalogView emits fallback-ready
```

Assert repeated fatal callbacks join one recovery promise, never mount a second Legacy renderer, never recurse, and never leave two canvases or contexts active.

- [ ] **Step 3: Run selection and fallback tests and verify RED**

Run:

```bash
npm run test:unit -- tests/unit/render/createRenderer.test.ts
npm run test:integration -- tests/integration/scene/rendererFallback.test.ts
```

Expected: `FAIL` because Batched selection and the one-shot recovery policy are absent.

- [ ] **Step 4: Implement dynamic loaders with no eager Legacy edge**

Use dynamic imports only:

```ts
export type RendererLoader = () => Promise<GraphRenderer>

export const loadBatchedRenderer: RendererLoader = async () => {
  const { BatchedStarRenderer } = await import('./BatchedStarRenderer')
  return new BatchedStarRenderer()
}

export const loadLegacyRenderer: RendererLoader = async () => {
  const { LegacyForceGraphRenderer } = await import('./LegacyForceGraphRenderer')
  return new LegacyForceGraphRenderer()
}
```

`createRenderer.ts` chooses the primary loader without importing either implementation eagerly. `SceneCoordinator` receives primary and optional fallback loaders; it never imports a renderer class.

Extend `ImportMetaEnv` in `src/vite-env.d.ts` with `readonly VITE_GRAPH_RENDERER?: 'legacy' | 'batched' | 'auto'`; invalid runtime/query values still follow the explicit test cases rather than widening this build-time type.

- [ ] **Step 5: Implement one serialized recovery chain**

Coordinator retains the latest valid immutable scene and current target. On a non-abort primary failure, it aborts pending work, awaits complete disposal, and uses the optional fallback exactly once. On fallback failure it awaits disposal, builds `StaticCatalogSnapshot` from the same repository/target, calls `showStatic`, and stops. `StaticCatalogView`, not Coordinator, remains the sole emitter of `fallback-ready`.

- [ ] **Step 6: Add test-only fault injection and host canvases**

Extend the existing Phase 1 benchmark facade instead of creating a second test-hook system. Add `setRendererFault(fault)` and `loseWebglContext()` controls to the frozen `window.__STAR_PERF__` surface, with `RendererFault = 'batched-init' | 'batched-shader' | 'batched-picking' | 'batched-restore' | 'legacy-load' | null`. Export `consumeRendererFault(point)` from `src/perf/testApi.ts` for the renderer loaders/lifecycle; it returns false and retains no mutable fault state unless `import.meta.env.VITE_STAR_BENCHMARK === '1'`. A normal production build replaces that guard with false and tree-shakes the controls and fault branches.

`StarMap` remains a host component. Add `data-testid="graph-host"`; Batched appends `.star-map-webgl` and `.star-map-labels`, and removes both before Legacy or Static mounts. Add only positioning, stable dimensions, and pointer-event CSS for those canvases.

- [ ] **Step 7: Verify selection and fallback GREEN**

Run:

```bash
npm run test:unit -- tests/unit/render/createRenderer.test.ts
npm run test:integration -- tests/integration/scene/rendererFallback.test.ts
npm run build
```

Expected: `PASS`; the normal build contains separate Batched and Legacy chunks, and Legacy is still the default until Task 14.

- [ ] **Step 8: Commit Phase 3A loader and fallback**

```bash
git add src/render/createRenderer.ts src/scene/SceneCoordinator.ts src/components/StarMap.tsx src/index.css src/perf/testApi.ts src/vite-env.d.ts tests/unit/render/createRenderer.test.ts tests/integration/scene/rendererFallback.test.ts
git commit -m "feat: add one-shot renderer fallback"
```

### Task 11: Prove Batched Navigation, Picking, Labels, And Visual Parity

**Files:**
- Create: `tests/browser/batched-navigation.spec.ts`
- Create: `tests/browser/batched-picking-labels.spec.ts`
- Create: `tests/browser/batched-visual.spec.ts`
- Create: `tests/integration/render/BatchedPortalContract.test.ts`
- Modify: `tests/helpers/canvas.ts`

- [ ] **Step 1: Add RED overview and sector browser cases**

Against a production build with `?renderer=batched`, assert C0 direct overview; ROOT2K sector overview; entering/exiting a sector; clicking a real sector; clicking a sector portal; exact `first-scene-frame`/`cluster-visible` epoch and counts; drag; zoom; background clear; and no D3 ticks.

- [ ] **Step 2: Add RED root portal and word behavior cases**

In `BatchedPortalContract.test.ts`, compile `projectCatalogScene(createTwoRootPortalProjectionInput())`, render it through the real Batched factory, and assert one global `portal:root:remote-root` whose CPU sidecar contains `contributingLocalRootIds: ['local-a', 'local-b']`. Use `LOD_MAX` in the production browser fixture; do not add a `PORTAL_CONTRACT` member to the locked fixture-name union. Assert the selected 1,200th relation forces its remote portal into the 64 slots, root portal click loads the remote root, word click paints the matching card, and a concrete word-card relation navigates to the remote word. `card-painted` must carry the selected word ID after React commit plus the next rAF; `chain-start` must carry the same `viewEpoch` and the renderer frame ID after the chain flags are rendered.

- [ ] **Step 3: Add RED picking and label cases**

Assert actual GPU picks for sector, sector portal, root, root portal, and word; background ID zero; hover no more than 30 Hz; drag suppresses hover; click reuse within 50 ms; desktop/mobile quotas; selected/hover labels beyond quota; and label alignment during root orbit.

- [ ] **Step 4: Add RED visual and canvas-pixel cases**

Freeze seed, camera, and shader time. Capture 1440x900 and 915x412 screenshots for overview, sector, root portal, selected word/chain, mastery color changes, Bloom on/off, locked state, root orbit, idle rotation, and reduced motion. Use `tests/helpers/canvas.ts` to assert a non-background pixel ratio and bounded label-to-node centroid distance; do not use nonblank pixels as readiness proof.

- [ ] **Step 5: Run browser tests and verify RED**

Run:

```bash
npm run test:integration -- tests/integration/render/BatchedPortalContract.test.ts
npm run test:browser -- tests/browser/batched-navigation.spec.ts tests/browser/batched-picking-labels.spec.ts tests/browser/batched-visual.spec.ts
```

Expected: at least one new assertion fails before behavior wiring and reference screenshots are complete.

- [ ] **Step 6: Wire missing callback and visual behavior**

Make only failures required by these tests in `BatchedStarRenderer`, `SceneGpuResources`, batch shaders, `PickingPass`, `LabelOverlay`, or `CameraController`. Preserve the locked contract: sector/root portals remain ordinary batched node instances with CPU navigation sidecars, not separate Mesh or DOM objects.

- [ ] **Step 7: Verify browser GREEN on both viewports**

Run:

```bash
npm run test:integration -- tests/integration/render/BatchedPortalContract.test.ts
npm run test:browser -- tests/browser/batched-navigation.spec.ts tests/browser/batched-picking-labels.spec.ts tests/browser/batched-visual.spec.ts
```

Expected: `PASS`; screenshots are stable, text does not overlap controls/cards, and all actual picks produce the intended semantic target.

- [ ] **Step 8: Commit browser parity coverage**

Before staging, use `git diff --name-only` to identify only the production files changed in Step 6, then list each of those paths explicitly after the four fixed test paths below. Do not use a directory-wide add.

```bash
git add tests/browser/batched-navigation.spec.ts tests/browser/batched-picking-labels.spec.ts tests/browser/batched-visual.spec.ts tests/integration/render/BatchedPortalContract.test.ts tests/helpers/canvas.ts
git add src/render/BatchedStarRenderer.ts src/render/batched/SceneGpuResources.ts src/render/batched/gpu/nodeBatches.ts src/render/batched/gpu/edgeBatches.ts src/render/batched/PickingPass.ts src/render/batched/LabelOverlay.ts src/render/batched/CameraController.ts
git commit -m "test: verify batched renderer behavior"
```

If a listed production file has no diff, omit that exact path from the second `git add`; never replace the command with a broad add.

### Task 12: Prove Context Recovery And Final Static Fallback

**Files:**
- Create: `tests/browser/renderer-fallback.spec.ts`
- Modify: `tests/integration/scene/rendererFallback.test.ts`

- [ ] **Step 1: Add RED successful context restore case**

Use the real `WEBGL_lose_context` extension through the test-only control surface. Assert scheduler pause, one restore, the same catalog/version/epoch/counts on the restored business frame, semantic selection preserved, one context, and no new Legacy network request.

- [ ] **Step 2: Add RED Phase 3A terminal failure cases**

Build with `VITE_STAR_BENCHMARK=1` and cover through the existing `window.__STAR_PERF__` control surface:

- Batched shader failure -> complete Batched disposal -> one Legacy load -> same scene.
- Batched picking failure -> one Legacy load.
- Batched context restore failure -> one Legacy load.
- Batched failure plus Legacy load failure -> `StaticCatalogView`.
- Explicit Legacy failure -> `StaticCatalogView` without a second Legacy attempt.

For Static, assert `fallback-ready` detail matches catalog, epoch, and navigable counts; sector/root/word/portal navigation remains functional; Sidebar and WordCard remain; and progress writes still use `star-vocab-progress-v1`.

- [ ] **Step 3: Run fallback tests and verify RED**

Run:

```bash
npm run build:benchmark
npm run test:browser -- tests/browser/renderer-fallback.spec.ts
```

Expected: at least one recovery, readiness, or cleanup assertion fails before final wiring.

- [ ] **Step 4: Fix recovery ordering without adding retries**

Make the minimum changes in `ContextLifecycle`, `BatchedStarRenderer`, and `SceneCoordinator`. The allowed recovery graph remains exactly `Batched -> Legacy once -> Static`; no timeout retry loop, second Legacy mount, blank canvas terminal state, or direct Coordinator `fallback-ready` mark is permitted.

- [ ] **Step 5: Verify fallback GREEN**

Run:

```bash
npm run test:integration -- tests/integration/scene/rendererFallback.test.ts
npm run build:benchmark
npm run test:browser -- tests/browser/renderer-fallback.spec.ts
```

Expected: `PASS`; each replaced renderer owns zero geometry, texture, listener, rAF, and canvas resources before the next renderer mounts.

- [ ] **Step 6: Commit fallback drills**

```bash
git add tests/browser/renderer-fallback.spec.ts tests/integration/scene/rendererFallback.test.ts src/render/batched/ContextLifecycle.ts src/render/BatchedStarRenderer.ts src/scene/SceneCoordinator.ts
git commit -m "test: verify renderer recovery chain"
```

### Task 13: Add Phase 3 Performance, Heap, Network, And Bundle Gates

**Files:**
- Modify: `package.json`
- Create: `scripts/run-phase3-d3.mjs`
- Create: `tests/perf/phase3.spec.ts`
- Create: `tests/perf/phase3-resource-plateau.spec.ts`
- Create: `tests/browser/batched-network.spec.ts`
- Modify: `scripts/check-bundle.mjs`
- Create: `tests/perf/verify-release-gate.mjs`
- Create: `tests/unit/perf/verifyReleaseGate.test.ts`

- [ ] **Step 1: Add RED locked-quality FPS cases**

In `phase3.spec.ts`, warm each animated scene for 5 seconds, sample 30 seconds, repeat three times, and take the median run. Use adjacent rAF timestamps as `presentIntervalMs`; never substitute `rendererWorkMs`.

Assert on D1, locked balanced, actual DPR 1.25:

- C0's 504-node/683-edge scene with Bloom on: median FPS >=55 and p95 <=20 ms.
- GPU10K with Bloom on: median FPS >=45 and p95 <=25 ms.
- GPU10K with Bloom off: median FPS >=55.
- Non-post draw calls <=20 and Bloom total draw calls <=60.
- Picking p95 <=8 ms and click feedback p95 <=150 ms.
- GPU10K compile plus upload <=1.5 seconds and no main-thread long task >100 ms.
- GPU25K records diagnostics, does not crash, and does not lose context; it is not a capacity claim.

- [ ] **Step 2: Independently assert actual DPR and locked visual features**

For every scored run, read `canvas.getBoundingClientRect()` and the real WebGL2 context's `drawingBufferWidth/Height`. Assert each dimension differs from `round(cssSize * 1.25)` by at most one pixel. Cross-check, but do not trust alone, `__STAR_PERF__.actualDpr`. Fail the run if quality changes, particles turn off, or Bloom differs from the requested on/off state.

Validate and save the complete environment signature before scoring. D1 is the plugged-in Apple Silicon Mac at 1440x900, device DPR 2, 60 Hz, low-power mode off, and nominal thermal state. D2 uses the same 60 Hz/power/thermal conditions at 1365x768, DPR 1, CPU 4x, 5 Mbps, and 100 ms RTT. D3 is the real Pixel 7a at 915x412 landscape, fixed 60 Hz, Battery Saver off, with thermal status recorded before and after each run. Include OS build, browser executable/package and major version, WebGL vendor/renderer, memory/chip, viewport, device DPR, power, and thermal fields. If any signature field differs from the saved baseline, enforce absolute budgets but refuse a relative comparison until a new baseline is recorded.

- [ ] **Step 3: Add RED adaptive-quality soak**

Run a separate 10-minute synthetic-work soak. Inject synthetic `rendererWorkMs` after real renderer work and before EWMA; keep real `presentIntervalMs` unchanged. Cover high, balanced, and low at 1.19/1.21 and 0.81/0.79, all three ceilings through full degradation and reverse recovery, plus low-no-particles/minimal at 33.3 ms. Assert transitions occur only at sample 120 or 300 and never skip a state.

- [ ] **Step 4: Add RED resource plateau test**

After switch 10, capture a sentinel scene, replay sequence, ordered repository/LRU `{key,sha256,bytes,pinned}` fingerprint, and renderer metrics. Complete 100 switches, replay the same sequence to restore the exact scene, key order, pinned state, and raw-byte fingerprints, then wait for pending repository work to reach zero and two stable frames. Run CDP GC three times and compare median heap samples.

Assert heap growth <=`max(10 MiB, baseline * 10%)`, geometry/texture deltas <=2, one context throughout, and zero renderer-owned resources after every full dispose. Also run 20 explicit production mount/unmount cycles.

- [ ] **Step 5: Add RED network and bundle checks**

`batched-network.spec.ts` must assert normal batched startup and all direct overview/sector/root/word/portal navigation never request the Legacy chunk. `check-bundle.mjs --phase=3a` must assert entry <=120 KiB gzip, Batched chunk <=300 KiB gzip, default batched transferred JS <=380 KiB gzip, and one Three.js runtime. Record but exclude the failure-only Legacy chunk from the default transfer total.

- [ ] **Step 6: Add and test the future release-gate verifier**

`verify-release-gate.mjs --compat=legacy` reads completed signed release reports and exits nonzero unless the two newest consecutive stable releases span at least 14 natural days, each with the complete D1/D2/D3 matrix, zero normal-path failures, no unresolved P0/P1, all locked-quality/resource/first-screen gates, a successful latest-to-previous rollback drill, readable progress, available old hashes, and an explicit 30-day retention record.

Validate this exact evidence shape before applying the gate:

```ts
interface LegacyExitReleaseReport {
  releaseId: string
  releaseTag: string
  candidateCommit: string
  sourcePhase2: {
    candidateCommit: string
    releaseVerificationSha256: string
  }
  releasedAt: string
  stable: true
  bundlePassed: true
  unresolvedIssues: { p0: 0; p1: 0 }
  devices: Record<'D1' | 'D2' | 'D3', {
    environmentSignature: string
    coldStarts: number
    navigations: number
    normalFailures: 0
    lockedQualityPassed: true
    firstScreenPassed: true
    resourcePlateauPassed: true
  }>
  faultInjectionPassed: true
  progressKeyReadable: true
  rollback: {
    previousBuildAvailable: true
    previousTagRestored: true
    lastKnownGoodManifestReadable: true
    oldHashesAvailable: true
  }
  retention: { previousBuildDays: number; oldHashDays: number }
  d3Runner: {
    name: 'run-phase3-d3.mjs'
    sourceSha256: string
    preflightEvidenceSha256: string
    deviceSerialHash: string
    remoteDebuggingAttached: true
    model: 'Pixel 7a'
    device: 'lynx'
    hardwareRenderer: string
    refreshHz: 60
    viewport: '915x412-landscape'
    batterySaver: false
    thermalBefore: 'nominal'
    thermalAfter: 'nominal'
  }
  attestation: {
    algorithm: 'ed25519'
    keyId: string
    payloadSha256: string
    signatureBase64: string
  }
}
```

Require D1 and D2 `coldStarts >=100` and `navigations >=250`, D3 `coldStarts >=30` and `navigations >=150`, and both retention day values >=30. Both reports must bind the same verified Phase 2 source commit/digest; that source must be an ancestor of each candidate, the first release candidate must be an ancestor of the second, each `releaseTag` must resolve to its exact `candidateCommit`, and both candidates must be ancestors of the evidence `baseCommit`. For D3, verify the runner source hash against `scripts/run-phase3-d3.mjs` at that candidate, verify the signed preflight artifact digest and nonempty serial hash, require `remoteDebuggingAttached: true`, and require every explicit Pixel model/device/hardware-renderer/refresh/viewport/Battery Saver/pre/post-thermal field above. Canonicalize every report without its `attestation`, verify `payloadSha256`, and use Node `crypto.verify` with an allowlisted release public key selected by `keyId`; an unknown key, invalid signature, altered payload, stale/wrong-branch commit, desktop/SwiftShader D3 provenance, or `bundlePassed !== true` fails closed.

Run:

```bash
npm run test:unit -- tests/unit/perf/verifyReleaseGate.test.ts
```

Expected after the RED test is added: `FAIL` because the verifier is absent. After implementation: `PASS` for a synthetic valid evidence pair and rejection for each missing criterion, a 13-day interval, wrong candidate ancestry/tag, mismatched Phase 2 digest, stale runner/preflight hash, missing serial binding or remote-debugging proof, desktop/SwiftShader D3, or non-nominal pre/post thermal field.

- [ ] **Step 7: Run Phase 3 gates and collect RED results**

Add `"perf:phase3:d3": "node scripts/run-phase3-d3.mjs"`. The runner reuses the Phase 2 Pixel 7a preflight and is the only allowed D3 entry point for Phase 3. It accepts optional `--phase3b` only to label the future Batched-only rerun; both modes require the same real device, hardware renderer, fixed 60 Hz, Battery Saver off, landscape viewport, Chrome remote-debugging connection, and nominal pre/post thermal evidence. It invokes the Phase 3 specs only after preflight and writes signed evidence to the release artifact directory; it never falls back to desktop Chrome or SwiftShader.

Run:

```bash
npm run build
npm run test:browser -- tests/browser/batched-network.spec.ts
node scripts/check-bundle.mjs --phase=3a
npm run build:benchmark
npm run perf:precompress
npx playwright test -c playwright.perf.config.ts --project=D1 tests/perf/phase3.spec.ts tests/perf/phase3-resource-plateau.spec.ts
```

Expected before tuning: tests execute against the production server and report exact failing budgets rather than lowering quality or silently changing thresholds.

- [ ] **Step 8: Tune only declared Batched implementation constants**

Change shader/buffer/batch scheduling constants only within the designed five quality states. Do not reduce fixture counts, visible limits, DPR, particle/Bloom requirements, sample duration, or portal counts. Break upload preparation into bounded stages only if the observed long-task report exceeds 100 ms.

- [ ] **Step 9: Verify complete GREEN on D1 and diagnostic GPU25K**

Run:

```bash
npm run test:unit -- tests/unit/perf/verifyReleaseGate.test.ts
npm run build
npm run test:browser -- tests/browser/batched-network.spec.ts
node scripts/check-bundle.mjs --phase=3a
npm run build:benchmark
npm run perf:precompress
npx playwright test -c playwright.perf.config.ts --project=D1 tests/perf/phase3.spec.ts tests/perf/phase3-resource-plateau.spec.ts
```

Expected: `PASS` for all hard gates; GPU25K produces a labeled diagnostic record with no context loss.

- [ ] **Step 10: Commit performance gates and any measured tuning**

List any tuned production file explicitly; this fixed command assumes all batch owners required tuning:

```bash
git add package.json scripts/run-phase3-d3.mjs tests/perf/phase3.spec.ts tests/perf/phase3-resource-plateau.spec.ts tests/browser/batched-network.spec.ts scripts/check-bundle.mjs tests/perf/verify-release-gate.mjs tests/unit/perf/verifyReleaseGate.test.ts src/render/BatchedStarRenderer.ts src/render/batched/SceneGpuResources.ts src/render/batched/gpu/nodeBatches.ts src/render/batched/gpu/edgeBatches.ts src/render/batched/gpu/backgroundBatches.ts
git commit -m "perf: enforce batched renderer budgets"
```

Omit an unchanged production path from `git add`; do not add any unlisted report directory or `.serena/`.

### Task 14: Make Batched The Phase 3A Default

**Files:**
- Modify: `src/render/createRenderer.ts`
- Modify: `vite.config.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `README.md`
- Modify: `tests/unit/render/createRenderer.test.ts`
- Modify: `tests/browser/batched-network.spec.ts`

- [ ] **Step 1: Change the RED expectation to Batched by default**

Update loader and network tests so no query and no build override expect Batched, while `?renderer=legacy` and `VITE_GRAPH_RENDERER=legacy` remain explicit Phase 3A acceptance paths.

- [ ] **Step 2: Run default-selection tests and verify RED**

Run:

```bash
npm run test:unit -- tests/unit/render/createRenderer.test.ts
npm run test:browser -- tests/browser/batched-network.spec.ts
```

Expected: `FAIL` because the implementation still defaults to Legacy.

- [ ] **Step 3: Switch only the default loader**

Set the build default and `auto` WebGL2 path to Batched. Keep the independent failure-only `loadLegacyRenderer()` dynamic import. Do not statically import Legacy from the entry, Coordinator, StarMap, or Batched modules. Update README to identify Batched as default and Legacy as a temporary Phase 3A recovery branch.

- [ ] **Step 4: Verify the complete Phase 3A matrix**

Run:

```bash
npm run build
npm run test:unit
npm run test:integration
npm run test:browser
node scripts/check-bundle.mjs --phase=3a
npm run build:benchmark
npm run perf:precompress
npx playwright test -c playwright.perf.config.ts --project=D1 --grep @phase3
npm ls three --all
npm run build
```

Expected: every command exits `0`; normal startup, ROOT2K navigation, and GPU10K do not download Legacy; explicit Legacy and injected-failure drills still work; only one Three.js runtime appears.

- [ ] **Step 5: Commit the Phase 3A default switch**

```bash
git add src/render/createRenderer.ts vite.config.ts src/vite-env.d.ts README.md tests/unit/render/createRenderer.test.ts tests/browser/batched-network.spec.ts
git commit -m "perf: make batched renderer the default"
```

- [ ] **Step 6: Run the fixed D2 and D3 release-candidate matrix**

Run on their configured environments:

```bash
npm run build:benchmark
npm run perf:precompress
npx playwright test -c playwright.perf.config.ts --project=D2 --grep @phase3
npm run perf:phase3:d3
```

Expected: D2 passes first-screen and main-thread budgets. Pixel 7a runs the 10-minute C0 interaction soak at median FPS >=40, p95 `presentIntervalMs` <=40 ms, click feedback p95 <=200 ms, with no context loss and unchanged thermal status for scored samples.

## Phase 3B: Current Execution Stop

Tasks 15-17 are intentionally recorded for a future release window. They are not authorized by completing Phase 3A tests alone. Do not check any Phase 3B box, delete any Legacy file, remove any dependency, or remove the renderer selector during the initial implementation session. A passing synthetic verifier unit test is never authorization: Task 16 may begin only in a distinct future release session after the signed Task 15 evidence artifact is committed on the base branch and the real-report verifier is rerun successfully immediately before deletion. The tracked evidence stores the canonical real-report digest, verifier version, and base commit so a stale or unrelated artifact cannot authorize deletion.

### Task 15: Prove The Legacy Exit Gate After Two Stable Releases

**Files:**
- Read: completed release reports under `test-results/releases/`
- Generate after passing: `docs/performance/phase-3a-release-evidence.json`

- [ ] **Step 1: Complete the first stable Phase 3A release matrix**

Record D1 100 cold starts plus 250 root/word jumps, D2 100 plus 250, and real Pixel 7a D3 30 starts plus 150 switches. Every normal attempt must have zero initialization failure, blank canvas, unhandled exception, progress loss, or Legacy activation. Complete all fault injections separately and confirm the expected Legacy or Static outcome without progress loss.

- [ ] **Step 2: Complete a second consecutive stable release at least 14 natural days later**

Repeat the entire independent D1/D2/D3 matrix with a second stable release. Both releases must pass locked-quality performance, first-screen, bundle, resource plateau, and normal-path zero-failure gates with no unresolved P0/P1 issue.

- [ ] **Step 3: Complete the rollback and retention drill**

Roll the latest release back to the previous stable tag. Verify previous build availability, old hashed data availability, last-known-good manifest behavior, and unchanged readability of `star-vocab-progress-v1`. Record that the previous build and old hashes remain retained for at least 30 days after the future Phase 3B release.

- [ ] **Step 4: Run the release-gate verifier**

Run:

```bash
node tests/perf/verify-release-gate.mjs --compat=legacy --reports-dir=test-results/releases --write=docs/performance/phase-3a-release-evidence.json
```

Expected today: nonzero exit because two qualifying releases spanning 14 days do not yet exist. Expected only in the future Phase 3B window: exit `0` and a complete evidence JSON derived from verified real reports, containing `reportsDigestSha256`, `verifierVersion`, `baseCommit`, both exact `releaseCommits`, and the bound `sourcePhase2Commit`/`sourcePhase2VerificationSha256`. A missing D3 result, failed bundle gate, invalid signature, wrong tag/commit ancestry, stale runner source, desktop/SwiftShader provenance, any normal-path failure, a 13-day interval, missing rollback, or missing 30-day retention record must fail closed.

- [ ] **Step 5: Commit real release evidence only after the verifier passes**

```bash
git add docs/performance/phase-3a-release-evidence.json
git commit -m "docs: record phase 3a release evidence"
```

### Task 16: Delete The Legacy Renderer In A Separate Phase 3B Release

**Files:**
- Delete: `src/render/LegacyForceGraphRenderer.ts`
- Delete: `src/render/graphRuntime.ts`
- Delete: `src/lib/threeNode.ts`
- Delete: `src/lib/render.ts`
- Modify: `src/render/createRenderer.ts`
- Modify: `src/scene/SceneCoordinator.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Modify: `README.md`
- Modify: `tests/unit/render/createRenderer.test.ts`
- Modify: `tests/integration/scene/rendererFallback.test.ts`
- Modify: `tests/browser/renderer-fallback.spec.ts`
- Modify: `scripts/check-bundle.mjs`

- [ ] **Step 1: Re-run the exit gate immediately before deletion**

Run:

```bash
git diff --exit-code -- docs/performance/phase-3a-release-evidence.json
git cat-file -e HEAD:docs/performance/phase-3a-release-evidence.json
node tests/perf/verify-release-gate.mjs --compat=legacy --reports-dir=test-results/releases --evidence=docs/performance/phase-3a-release-evidence.json --require-tracked-at=HEAD
```

Expected: all commands exit `0`. The verifier recomputes the canonical digest from the currently signed real reports, requires it to equal the tracked evidence digest, verifies that the evidence `baseCommit`, both release commits, and bound Phase 2 source have the required ancestry to `HEAD`, resolves each release tag to its recorded candidate, rechecks each candidate's D3 runner source hash/provenance, and requires the tracked blob at `HEAD` to match the working-tree file. Any missing, stale, altered, untracked, wrong-branch, wrong-commit, invalid-signature, or nonzero result stops this task without file changes.

- [ ] **Step 2: Change fallback tests to RED Batched-to-Static behavior**

Remove Legacy expectations. Assert no WebGL2, initialization failure, shader failure, picking failure, and context restore failure all cause Coordinator to await Batched disposal, publish one `StaticCatalogSnapshot`, and mount `StaticCatalogView`, which then emits `fallback-ready`. Assert no renderer retry and no Legacy network request.

- [ ] **Step 3: Run Phase 3B fallback tests and verify RED**

Run:

```bash
npm run test:unit -- tests/unit/render/createRenderer.test.ts
npm run test:integration -- tests/integration/scene/rendererFallback.test.ts
npm run build:benchmark
npm run test:browser -- tests/browser/renderer-fallback.spec.ts
```

Expected: `FAIL` because Legacy loader and fallback behavior still exist.

- [ ] **Step 4: Remove Legacy code using apply_patch deletions**

Delete the four listed Legacy-only source files. Before deletion, run `rg` to confirm `FrameScheduler`, `qualityController`, `resourceRegistry`, contracts, and Batched modules do not import them. Keep those shared modules.

Simplify `createRenderer.ts` to return Batched only. Remove `loadLegacyRenderer`, renderer query/build selection, optional fallback loader injection, and the Legacy recovery state. Keep Coordinator's final Static path and unchanged `GraphRenderer` contract.

- [ ] **Step 5: Remove ForceGraph packages and selector configuration**

Run:

```bash
npm uninstall react-force-graph-3d three-spritetext 3d-force-graph three-forcegraph
```

Remove `VITE_GRAPH_RENDERER` handling, its `ImportMetaEnv` declaration in `src/vite-env.d.ts`, and any manual Legacy chunk rule from Vite configuration. Update README to describe Batched-only 3D plus `StaticCatalogView` fallback and stable-tag full-renderer rollback.

- [ ] **Step 6: Strengthen the Phase 3B bundle gate**

Make `check-bundle.mjs --phase=3b` fail if package.json, package-lock, emitted JS, or source contains production references to `react-force-graph-3d`, `3d-force-graph`, `three-forcegraph`, `three-spritetext`, `LegacyForceGraphRenderer`, or renderer selection query logic. Assert all production JS gzip <=380 KiB and exactly one Three.js runtime.

- [ ] **Step 7: Verify Phase 3B fallback GREEN**

Run:

```bash
npm run test:unit -- tests/unit/render/createRenderer.test.ts
npm run test:integration -- tests/integration/scene/rendererFallback.test.ts
npm run build:benchmark
npm run test:browser -- tests/browser/renderer-fallback.spec.ts
npm run build
node scripts/check-bundle.mjs --phase=3b
npm ls three --all
```

Expected: `PASS`; failures terminate at the navigable Static view, forbidden packages are absent, emitted output has no Legacy chunk, and one Three.js 0.184.x runtime remains.

- [ ] **Step 8: Commit the atomic Phase 3B deletion**

```bash
git add src/render/LegacyForceGraphRenderer.ts src/render/graphRuntime.ts src/lib/threeNode.ts src/lib/render.ts src/render/createRenderer.ts src/scene/SceneCoordinator.ts src/vite-env.d.ts package.json package-lock.json vite.config.ts README.md tests/unit/render/createRenderer.test.ts tests/integration/scene/rendererFallback.test.ts tests/browser/renderer-fallback.spec.ts scripts/check-bundle.mjs
git commit -m "refactor: remove legacy force graph renderer"
```

### Task 17: Requalify The Batched-Only Phase 3B Release

**Files:**
- Generate: release reports under `test-results/releases/`
- Preserve: `docs/performance/phase-3a-release-evidence.json`

- [ ] **Step 1: Run all correctness and browser suites**

Run:

```bash
npm run test:unit
npm run test:integration
npm run test:browser
npm run build
```

Expected: `PASS` for direct overview, sector entry/exit, sector portal, root portal, word navigation, lock/chain, progress persistence, context failure to Static, Static navigation, and readiness marks.

- [ ] **Step 2: Re-run locked-quality, ROOT2K, GPU10K, and resource gates**

Run on fixed environments:

```bash
npm run build:benchmark
npm run perf:precompress
npx playwright test -c playwright.perf.config.ts --project=D1 --grep @phase3
npx playwright test -c playwright.perf.config.ts --project=D2 --grep @phase3
npm run perf:phase3:d3 -- --phase3b
npm run build
node scripts/check-bundle.mjs --phase=3b
```

Expected: every Phase 3A hard budget passes again without Legacy; D3 uses the real Pixel 7a; GPU25K remains diagnostic; heap and GPU resources return to the specified platform.

- [ ] **Step 3: Verify the rollback artifact remains available**

Deploy Phase 3B without deleting the previous stable Phase 3A build or its data hashes. Exercise a rollback to that stable tag and confirm it still reads `star-vocab-progress-v1` without migration.

- [ ] **Step 4: Record the Phase 3B release result without changing thresholds**

Store the signed environment reports in the release artifact system. Do not commit generated `test-results/` or stage `.serena/`. If any hard gate fails, roll back to the retained Phase 3A tag and fix the failing Phase 3B commit before another release attempt.

## Final Verification Checklist

- [ ] Phase 3A started only after Phase 2 correctness, performance, D1/D2/D3, and one-Three gates passed.
- [ ] `SceneCompiler` consumes the Phase 2 `SceneSnapshot` directly and supports sector, root, word, sector portal, and root portal nodes.
- [ ] Portal target, relation IDs, remote word IDs, contributing local roots, labels, and word cards remain CPU-only.
- [ ] Nodes, member lines, semantic lines, particles, background stars, nebulae, and meteors use bounded batches with no per-node Mesh, SpriteText, texture, or material.
- [ ] Nodes, edges, particles, and picking share the same GLSL node-position resolver.
- [ ] Picking is a real 1x1 GPU pass with exact throttle, reuse, and minimum hit radii.
- [ ] Labels obey deterministic priority, 80/40 quotas, and selected/hover exemptions.
- [ ] `FrameScheduler` is the only renderer rAF and quality EWMA consumes only `rendererWorkMs`.
- [ ] FPS and percentile gates consume only adjacent-rAF `presentIntervalMs`.
- [ ] Actual DPR is independently proven from CSS and drawing-buffer dimensions.
- [ ] Scene loads stage, atomically swap, resolve after the correct business frame, roll back on failure, and free superseded resources.
- [ ] Phase 3A recovery terminates at Batched -> Legacy once -> Static, with only one mounted renderer.
- [ ] Normal Phase 3A traffic never downloads Legacy.
- [ ] Phase 3B remains unexecuted until two stable releases, at least 14 days, complete zero-failure D1/D2/D3 matrices, rollback evidence, and 30-day retention all pass.
- [ ] Phase 3B removes Legacy only in its own release and re-runs every Batched correctness, performance, bundle, and resource gate.
