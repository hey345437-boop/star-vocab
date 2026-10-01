# Phase 1 ForceGraph Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the current ForceGraph experience so it builds cleanly, renders through a lifecycle-safe imperative contract, stops D3 after layout, preserves the existing progress payload, and has reproducible performance gates.

**Architecture:** A validated monolith `CatalogRepository` feeds immutable scene snapshots to a single `SceneCoordinator`, which is the only 3D Zustand subscriber. The coordinator loads a dynamically imported `LegacyForceGraphRenderer`; that renderer uses `three-forcegraph` inside one owned Three.js runtime and one `FrameScheduler`, while React owns only the shell, host element, and static fallback.

**Tech Stack:** React 18, React DOM client/`act`, TypeScript, Zustand, Vite 5, Three.js 0.184, three-forcegraph, Vitest 2, jsdom 25, Playwright, Node.js core HTTP/zlib.

---

## Execution Constraints

- Preserve `public/data/roots.json`, `public/data/words.json`, `public/data/wordlinks.json`, and the exact localStorage key `star-vocab-progress-v1` with a top-level `Record<string, Progress>` payload.
- Never stage `.serena/`. Every commit below uses an explicit `git add` allowlist; do not use `git add .` or `git add -A`.
- Keep the temporary `legacyForceOrbit` comparison switch until a score-eligible Phase 1 run passes. The earlier battery observation was non-scoring; every execution must probe power, low-power mode, refresh rate, thermal state, browser, OS, and GPU again. AC power by itself does not make a run eligible, and an ineligible run never claims numeric device budgets.
- D3 is not executable in the current environment because `adb` is unavailable. Record `skipped: no-adb`; do not synthesize Pixel 7a measurements and do not claim mobile-GPU acceptance.
- Production performance is measured from a production build served by the benchmark server. Vite development mode is used only for the React StrictMode lifecycle test.
- The first generated report is a baseline. It records evidence and never converts missing or ineligible samples into a passing result.

## Current Reproducible Baseline

- `./node_modules/.bin/tsc --noEmit --pretty false -p tsconfig.json` exits 2 with 10 diagnostics covering `import.meta.env`, Three declarations, `UnrealBloomPass`, and `SpriteText` inheritance.
- `./node_modules/.bin/vite build --outDir /tmp/star-vocab-phase1-baseline-20260719 --emptyOutDir` succeeds with one JS asset: 1,663.25 kB raw and 458.37 KiB gzip.
- `npm ls three --all` reports both `three@0.169.0` and `three@0.184.0`.
- C0 contains 72 roots, 432 words, 251 word relations, 504 nodes, and 683 total edges. The three JSON files total 198,483 raw bytes and 43,715 gzip-level-9 bytes.
- Raw ID `scope` exists as both a root and a word, so prefixed scene keys are a correctness requirement, not only an optimization.

### Task 1: Establish Test Tooling Without Changing the Production Runtime

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Create: `tsconfig.test.json`
- Create: `src/vite-env.d.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/unit/smoke.test.ts`

- [ ] **Step 1: Reproduce the current type-check failure**

Run:

```bash
./node_modules/.bin/tsc --noEmit --pretty false -p tsconfig.json
```

Expected: exit 2 with the 10 existing diagnostics, including `Property 'env' does not exist on type 'ImportMeta'` and missing declarations for `three`.

- [ ] **Step 2: Install only the exact test and type dependencies**

Run:

```bash
npm install --save-dev --save-exact @types/node@24.13.3 @types/three@0.184.0 vitest@2.1.9 jsdom@25.0.1 @playwright/test@1.61.1
```

Expected: the command exits 0 and updates only the development dependency section of `package.json` plus `package-lock.json`. The production dependency declarations for `three`, `react-force-graph-3d`, `three-forcegraph`, and `three-spritetext` remain byte-for-byte unchanged until the Task 2 baseline report exists. Vitest remains on 2.1.9 because Vitest 4 requires Vite 6 or newer. Do not install `@testing-library/react`; component tests use the React and React DOM APIs already present in the application.

- [ ] **Step 3: Add deterministic scripts and environment declarations**

Add these scripts to `package.json`:

```json
{
  "typecheck": "tsc --noEmit -p tsconfig.json",
  "typecheck:test": "tsc --noEmit -p tsconfig.test.json",
  "test:unit": "vitest run",
  "test:browser": "playwright test"
}
```

Do not add npm `overrides`. Task 2 will use exact top-level runtime versions and `npm ls three --all` after the pre-change report; an override here can both contaminate the baseline and produce `EOVERRIDE` against an exact direct dependency.

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STAR_BENCHMARK?: '0' | '1'
}
```

Keep `tsconfig.json` production-focused by including `src` and the Vite declaration only. Create `tsconfig.test.json` so test and configuration files are checked independently:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": [
    "src",
    "tests/**/*.ts",
    "tests/**/*.tsx",
    "vitest.config.ts",
    "playwright.config.ts"
  ]
}
```

Tests import Vitest and Playwright APIs explicitly; do not add ambient Vitest globals.

- [ ] **Step 4: Add the minimal Vitest and Playwright configuration**

Create `vitest.config.ts` with the default `environment: 'node'`, `setupFiles: ['./tests/setup.ts']`, `restoreMocks: true`, and test inclusion for `tests/unit/**/*.test.ts` and `tests/components/**/*.test.tsx`. Each component test file must begin with `// @vitest-environment jsdom`; unit tests stay in Node.

Component tests must mount with `createRoot` from `react-dom/client`, import `act` from `react`, wrap render, interaction, and unmount work in `act`, and unmount their root during cleanup. Do not use Testing Library helpers.

Create `playwright.config.ts` with `testDir: './tests'`, `testMatch: '**/*.spec.ts'`, `baseURL: 'http://127.0.0.1:4173'`, trace-on-first-retry, and projects named `desktop`, `mobile-viewport`, and `benchmark`. Set `use.channel: 'chrome'` for every project so the suite uses the installed system Chrome and never depends on a Playwright-downloaded browser. Do not add a web server until Task 2 creates it.

Create the smoke test:

```ts
import { describe, expect, it } from 'vitest'

describe('test runner', () => {
  it('runs TypeScript unit tests', () => {
    expect(2 + 2).toBe(4)
  })
})
```

- [ ] **Step 5: Verify the GREEN tooling against the unchanged runtime**

Run each command separately:

```bash
npm run typecheck
npm run typecheck:test
npm run test:unit -- tests/unit/smoke.test.ts
npm run build
npm ls three --all
```

Expected: all commands exit 0; production and test TypeScript projects both pass; the smoke test reports one passing test in the Node environment; `npm run build` produces `dist`; `npm ls three --all` still exposes the pre-change runtime tree with both Three 0.169.0 and 0.184.0. That duplicate is expected here and proves Task 1 did not move the production baseline before measurement.

- [ ] **Step 6: Commit the dependency boundary**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.test.json src/vite-env.d.ts vitest.config.ts playwright.config.ts tests/setup.ts tests/unit/smoke.test.ts
git commit -m "test: add phase one test tooling"
```

### Task 2: Capture the Original Runtime Baseline, Then Align Runtime Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `playwright.config.ts`
- Modify: `.gitignore`
- Modify: `src/components/StarMap.tsx`
- Create: `.env.benchmark`
- Create: `src/perf/baselineHook.ts`
- Create: `scripts/perf-server.mjs`
- Create: `tests/perf/support/raf.ts`
- Create: `tests/perf/support/environment.ts`
- Create: `tests/perf/phase0-baseline.spec.ts`

- [ ] **Step 1: Write the RED baseline test**

Create `tests/perf/phase0-baseline.spec.ts` with the following required flow:

```ts
import { expect, test } from '@playwright/test'
import { collectPresentIntervals } from './support/raf'
import { collectEnvironmentSignature } from './support/environment'

test('records C0 overview, word, and root samples without scoring', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  const signature = await collectEnvironmentSignature(page)
  const overview = await collectPresentIntervals(page, 600)
  await expect.poll(() => page.evaluate(() => Boolean(window.__STAR_PHASE0__))).toBe(true)
  await page.evaluate(() => window.__STAR_PHASE0__!.navigateWord('spect', 'inspect'))
  const word = await collectPresentIntervals(page, 600)
  await page.evaluate(() => window.__STAR_PHASE0__!.focusRoot('spect'))
  const root = await collectPresentIntervals(page, 600)
  expect({ signature, overview, word, root }).toMatchObject({
    signature: { scoreEligible: false },
  })
})
```

The helper must calculate only `presentIntervalMs[i] = rafTimestamp[i] - rafTimestamp[i - 1]`; it must not substitute renderer CPU work.

- [ ] **Step 2: Run the RED command**

Run:

```bash
npm run perf:baseline
```

Expected: npm exits 1 with `Missing script: "perf:baseline"`.

- [ ] **Step 3: Add the benchmark-only hook and environment signature**

Create `.env.benchmark`:

```dotenv
VITE_STAR_BENCHMARK=1
```

Define the temporary hook in `src/perf/baselineHook.ts`:

```ts
export interface PhaseZeroHook {
  focusRoot(rootId: string): void
  navigateWord(rootId: string, wordId: string): void
}

declare global {
  interface Window {
    __STAR_PHASE0__?: Readonly<PhaseZeroHook>
  }
}

export function installPhaseZeroHook(hook: PhaseZeroHook): () => void {
  if (import.meta.env.VITE_STAR_BENCHMARK !== '1') return () => undefined
  window.__STAR_PHASE0__ = Object.freeze(hook)
  return () => {
    delete window.__STAR_PHASE0__
  }
}
```

Mount it from the existing `StarMap` using its current root-focus and word-selection actions, and always remove it in the effect cleanup. The benchmark-mode wrapper must apply the fixed C0_COMPARE camera/script settings without changing a normal build. No normal production build may contain or expose `window.__STAR_PHASE0__`.

`collectEnvironmentSignature` must record browser executable/major, OS, viewport, display refresh declaration, device DPR, WebGL vendor/renderer, power/low-power state, and thermal state. A Phase 0 baseline is always `scoreEligible: false` because it establishes evidence rather than passing a candidate; record the live physical eligibility fields and `ineligibleReasons` independently instead of hard-coding the earlier battery observation or omitting fields.

- [ ] **Step 4: Add the baseline server and scripts**

Implement `scripts/perf-server.mjs` with Node `http`, path containment checks, correct MIME types, and port 4173. At this stage it serves `dist` without claiming production gzip parity; Task 14 upgrades it before official gates.

Modify `playwright.config.ts` to add a single `webServer` entry with `command: 'npm run benchmark:serve'`, URL `http://127.0.0.1:4173`, and `reuseExistingServer: false`. Every `test:browser`, `perf:baseline`, and later `perf:phase1` Playwright invocation therefore starts and stops its own server; no command may rely on a manually running process.

Add scripts:

```json
{
  "build:benchmark": "vite build --mode benchmark",
  "benchmark:serve": "node scripts/perf-server.mjs",
  "perf:baseline": "playwright test tests/perf/phase0-baseline.spec.ts --project=benchmark"
}
```

Add `artifacts/perf/` to `.gitignore`. The test writes `artifacts/perf/phase0-c0.json` with `reportKind: "baseline"`, `fixture: "C0_COMPARE"`, `scoreEligible: false`, raw samples, percentiles, the resolved pre-upgrade runtime versions, the complete signature, and immutable rollback provenance: the full `sourceCommit` from `git rev-parse HEAD`, `sourceTree` from `git rev-parse HEAD^{tree}`, and `packageLockSha256`. The Task 1 commit is the explicit previous stable source for this runtime baseline; no Git tag is assumed to exist. The report must prove that overview, `navigateWord('spect', 'inspect')`, `focusRoot('spect')`, and the fixed relation-chain script all ran through the benchmark-only window hook; it must not reference a DOM test ID that the current UI does not expose.

- [ ] **Step 5: Run the GREEN non-scoring baseline**

Run each command separately:

```bash
npm run build:benchmark
npm run perf:baseline -- --headed
```

Expected: both commands exit 0 and Playwright starts/stops `benchmark:serve` itself; `artifacts/perf/phase0-c0.json` exists before any production dependency upgrade; all three scenes contain rAF-derived samples; the report records the duplicate pre-change Three tree, resolves `sourceCommit` to the current Task 1 HEAD and matching tree/lock digest, says `scoreEligible: false`, and contains no `passed: true` performance claim.

- [ ] **Step 6: Commit the baseline harness**

```bash
git add package.json playwright.config.ts .gitignore .env.benchmark src/components/StarMap.tsx src/perf/baselineHook.ts scripts/perf-server.mjs tests/perf/support/raf.ts tests/perf/support/environment.ts tests/perf/phase0-baseline.spec.ts
git commit -m "test: capture phase zero performance baseline"
```

- [ ] **Step 7: Pin and align the production runtime only after the report exists**

Run:

```bash
test -s artifacts/perf/phase0-c0.json
npm install --save-exact three@0.184.0 react-force-graph-3d@1.29.1 three-forcegraph@1.43.4 three-spritetext@1.10.0
```

Expected: the report precondition exits 0 before npm runs. npm then updates only `package.json` and `package-lock.json`; the four direct production dependencies are exact versions, and no `overrides` entry exists.

- [ ] **Step 8: Verify the GREEN single-Three runtime without rewriting the baseline**

Run each command separately:

```bash
npm run typecheck
npm run typecheck:test
npm run build
npm ls three --all
```

Expected: all commands exit 0; every runtime consumer resolves to `three@0.184.0` or `deduped`; no second Three version or `EOVERRIDE` appears; `artifacts/perf/phase0-c0.json` still reports the original pre-upgrade tree and remains unchanged.

- [ ] **Step 9: Commit the runtime alignment separately**

```bash
git add package.json package-lock.json
git commit -m "build: align three after baseline capture"
```

### Task 3: Build Stable Keys and O(N+E) Graph Indexes

**Files:**
- Modify: `src/types.ts`
- Create: `src/graph/graphModel.ts`
- Create: `tests/unit/graphModel.test.ts`

- [ ] **Step 1: Write failing key-collision and index tests**

Create a fixture with root ID `scope`, word ID `scope`, a second word `telescope`, one member edge per word, and one relation. Assert:

```ts
const model = buildGraphModel(roots, words, relations)

expect(model.nodeByKey.get('root:scope')?.kind).toBe('root')
expect(model.nodeByKey.get('word:scope')?.kind).toBe('word')
expect(model.nodes).toHaveLength(3)
expect(model.edges).toHaveLength(3)
expect(model.relationNeighborNodeIndicesByWordId.get('scope')).toEqual(
  Uint32Array.from([model.nodeIndexByKey.get('word:telescope')!]),
)
expect(model.edgeOffsets).toHaveLength(model.nodes.length + 1)
```

Add a C0 test that imports the public JSON fixtures and asserts 504 nodes, 683 edges, unique prefixed keys, 72 `rootById` entries, and 432 `wordById` entries.

- [ ] **Step 2: Run the RED graph-model test**

Run:

```bash
npm run test:unit -- tests/unit/graphModel.test.ts
```

Expected: FAIL because `src/graph/graphModel.ts` does not exist.

- [ ] **Step 3: Implement stable scene keys and new graph-model records**

Export these key types and constructors:

```ts
export type RootNodeKey = `root:${string}`
export type WordNodeKey = `word:${string}`
export type SectorNodeKey = `sector:${string}`
export type SectorPortalKey = `portal:sector:${string}:${string}`
export type RootPortalKey = `portal:root:${string}`
export type SceneNodeKey = RootNodeKey | WordNodeKey | SectorNodeKey | SectorPortalKey | RootPortalKey
export type SceneEdgeKey = `rel:${string}:${string}:${string}` | `member:${string}:${string}`

export const rootKey = (id: string): RootNodeKey => `root:${id}`
export const wordKey = (id: string): WordNodeKey => `word:${id}`
```

`relationKey(type, a, b)` must sort the two prefixed word keys before interpolation. Preserve raw word IDs separately for progress and word-card lookup.

Define new immutable `GraphModelNode` and `GraphModelEdge` records for the indexed model. Do not reuse or rename the existing mutable `GraphNode` and `GraphLink`: the current `StarMap` and `src/lib/threeNode.ts` still require those adapter-facing shapes until the imperative renderer migration is complete.

- [ ] **Step 4: Implement one-pass graph construction and indexes**

`buildGraphModel` must:

1. Build `rootById` once.
2. Append roots, then words, using `rootById.get` rather than `roots.find`.
3. Append member edges and word-relation edges while accumulating degree and per-node incident edge arrays.
4. Flatten incident arrays into CSR `edgeOffsets` and `edgeIndices`.
5. Build `wordsByRootId`, `orbitNodeIndicesByRootId`, deduplicated `orbitEdgeIndicesByRootId`, and `relationNeighborNodeIndicesByWordId`.
6. Freeze plain arrays and records before returning; treat typed arrays as read-only by contract.

Retain the old mutable `GraphNode` and `GraphLink` declarations as compatibility types throughout Phase 1. Task 9 converts `GraphModelNode`/`GraphModelEdge` into renderer-owned mutable ForceGraph records at the adapter boundary, while existing callers continue to type-check during the migration. Delete the compatibility declarations only in a later, separately reviewed cleanup after `rg 'GraphNode|GraphLink' src` proves there are no imports outside that adapter; their removal is not a Phase 1 acceptance condition.

- [ ] **Step 5: Verify the GREEN graph model**

Run:

```bash
npm run test:unit -- tests/unit/graphModel.test.ts
npm run typecheck
```

Expected: both commands exit 0; the C0 test reports the exact 504/683 counts and the `scope` collision test passes; existing `StarMap` and `threeNode` imports of compatibility `GraphNode`/`GraphLink` still type-check.

- [ ] **Step 6: Commit the model boundary**

```bash
git add src/types.ts src/graph/graphModel.ts tests/unit/graphModel.test.ts
git commit -m "feat: add indexed graph model"
```

### Task 4: Add a Validated Monolith Catalog Repository

**Files:**
- Create: `src/data/catalogSchema.ts`
- Create: `src/data/CatalogRepository.ts`
- Create: `tests/unit/CatalogRepository.test.ts`

- [ ] **Step 1: Write failing repository behavior tests**

Cover request coalescing, consumer abort isolation, schema rejection, reference rejection, and retry after failure:

```ts
const repository = new CatalogRepository({ baseUrl: '/app/', fetch: fetchMock })
const first = repository.loadCatalog()
const second = repository.loadCatalog()
const [a, b] = await Promise.all([first, second])

expect(fetchMock).toHaveBeenCalledTimes(3)
expect(a).toBe(b)
expect(Object.isFrozen(a.words)).toBe(true)
```

For abort isolation, abort one consumer and assert its promise rejects with `AbortError` while the second consumer resolves from the same three underlying requests.

- [ ] **Step 2: Run the RED repository test**

Run:

```bash
npm run test:unit -- tests/unit/CatalogRepository.test.ts
```

Expected: FAIL because `CatalogRepository` cannot be imported.

- [ ] **Step 3: Implement explicit runtime validation**

Define:

```ts
export interface Catalog {
  readonly catalogVersion: 'monolith-v1'
  readonly roots: readonly Root[]
  readonly words: readonly Word[]
  readonly relations: readonly WordLink[]
}

export interface CatalogRepositoryOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
}
```

Validate every required string, root/word uniqueness, every `word.rootId`, every relation endpoint, supported relation types, no self-edge, and no duplicate stable relation key. Reject the complete catalog on any violation; never return a partially validated array.

- [ ] **Step 4: Implement shared loading with per-consumer abort**

Use one cached underlying `Promise<Catalog>`. `loadCatalog({ signal })` races the shared promise against only that consumer's signal. Clear the cached promise after an underlying fetch, HTTP, JSON, or validation failure so retry starts a fresh three-request attempt. Do not pass a consumer signal into the shared `fetch` calls.

- [ ] **Step 5: Verify repository data and retry semantics**

Run:

```bash
npm run test:unit -- tests/unit/CatalogRepository.test.ts
npm run typecheck
```

Expected: exit 0; concurrent callers use three fetches total; malformed data rejects; retry after failure makes a new request set; validated C0 remains 72/432/251.

- [ ] **Step 6: Commit the repository**

```bash
git add src/data/catalogSchema.ts src/data/CatalogRepository.ts tests/unit/CatalogRepository.test.ts
git commit -m "feat: add validated catalog repository"
```

### Task 5: Make Navigation Atomic and Preserve Progress Persistence

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/components/StarMap.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Controls.tsx`
- Modify: `src/components/WordCard.tsx`
- Create: `tests/unit/useStore.test.ts`
- Create: `tests/components/navigationConsumers.test.tsx`

- [ ] **Step 1: Write failing navigation and persistence tests**

Cover mutually exclusive targets, repeated-word nonce, request sequence, original event timestamps, same-value short-circuit, exact storage payload, write failure, and retry:

```ts
const store = createStarStore(storage)
store.getState().navigate({ kind: 'word', rootId: 'spect', wordId: 'inspect' }, 123.5)
const first = store.getState()
store.getState().navigate({ kind: 'word', rootId: 'spect', wordId: 'inspect' }, 456.75)
const second = store.getState()

expect(first.target).toMatchObject({ kind: 'word', nonce: 1 })
expect(first.navigationRequest).toMatchObject({ sequence: 1, eventTimeStamp: 123.5 })
expect(second.target).toMatchObject({ kind: 'word', nonce: 2 })
expect(second.navigationRequest).toMatchObject({ sequence: 2, eventTimeStamp: 456.75 })
```

Seed storage with an existing `srs` object, change mastery, parse `star-vocab-progress-v1`, and assert the top-level value is still only a word-ID record and the `srs` fields survive.

Add a file-level-jsdom consumer test that clicks Sidebar, Controls, WordCard relation, and legacy StarMap navigation surfaces. Assert each calls only `navigate(intent, event.timeStamp)`, that repeated random-word selection advances the request, and that no component reads or invokes `selectedWordId`, `focusRootId`, `selectWord`, or `focusRoot`.

- [ ] **Step 2: Run the RED store test**

Run:

```bash
npm run test:unit -- tests/unit/useStore.test.ts
npm run test:unit -- tests/components/navigationConsumers.test.tsx
```

Expected: FAIL because the store and its consumers still expose independent `selectedWordId`/`focusRootId` and `selectWord`/`focusRoot`, have no navigation envelope, and have no retryable persistence error.

- [ ] **Step 3: Replace illegal combinations with semantic targets**

Add:

```ts
export type ViewTarget =
  | { kind: 'overview' }
  | { kind: 'sector'; sectorId: string }
  | { kind: 'root'; rootId: string }
  | { kind: 'word'; rootId: string; wordId: string; nonce: number }

export type NavigationIntent =
  | { kind: 'overview' }
  | { kind: 'sector'; sectorId: string }
  | { kind: 'root'; rootId: string }
  | { kind: 'word'; rootId: string; wordId: string }

export interface NavigationRequest {
  readonly sequence: number
  readonly target: ViewTarget
  readonly eventTimeStamp: number | null
}
```

The store keeps `target`, `navigationRequest: NavigationRequest | null`, `query`, user `bloom`, `qualityCeiling: 'high' | 'balanced' | 'low'`, `progress`, `lastProgressChange`, and `persistenceError`. It stores no Three objects. `NavigationRequest` is the immutable envelope used unchanged by Store -> `SceneCoordinator` -> the renderer navigate command; programmatic navigation records `eventTimeStamp: null`, while pointer and keyboard paths preserve the browser event's original numeric `timeStamp` exactly.

- [ ] **Step 4: Implement an injectable store factory and synchronous persistence**

Export `createStarStore(storage)` and instantiate the production bound hook from `window.localStorage`. `navigate(intent, eventTimeStamp?)` must create the semantic `ViewTarget` and increment a global request `sequence`; it also increments nonce for every word intent, even when root and word IDs are unchanged. One Zustand `set` call publishes `target` and `navigationRequest` atomically. Overview, sector, and root intents return the prior state object when semantically equal. Phase 1 may commit this target/request pair immediately because all monolith data is resident; Phase 2 may stage asynchronous loading and split requested versus committed target without changing the envelope.

`setMastery` must:

1. Return without writing when status is unchanged.
2. Preserve all existing progress fields for the word.
3. Call `storage.setItem('star-vocab-progress-v1', JSON.stringify(progress))` synchronously.
4. Keep the new in-memory progress if `setItem` throws.
5. Set a visible `persistenceError` and retain the exact attempted progress for `retryPersistence`.

- [ ] **Step 5: Atomically migrate every existing navigation consumer**

Update `StarMap`, `Sidebar`, `Controls`, and `WordCard` in this task, not later:

1. Derive selected word/root solely from the discriminated `target`; do not retain duplicate compatibility fields or actions.
2. Route node clicks, list rows, random word, root focus, relation navigation, close/back, and mastery-next through `navigate(intent, event.timeStamp)`.
3. Remove the 40 ms clear-and-reselect timer and 540 ms next-word timer; repeated word intent is represented by nonce/request sequence.
4. Ensure every word intent includes both `rootId` and `wordId`; relation navigation resolves the target word's root before dispatch.
5. Preserve programmatic intent with a null timestamp rather than manufacturing `performance.now()`.

`Hud` reads progress only and therefore needs no edit. After migration, `rg 'selectedWordId|focusRootId|selectWord|focusRoot' src/components src/store` may match benchmark hook method names only; it must not find Store state fields, actions, or consumer compatibility code.

- [ ] **Step 6: Verify exact protocol preservation and consumer migration**

Run:

```bash
npm run test:unit -- tests/unit/useStore.test.ts
npm run test:unit -- tests/components/navigationConsumers.test.tsx
npm run typecheck
npm run typecheck:test
```

Expected: exit 0; nonce and request sequence reach 2; both original timestamps survive exactly; all navigation consumers use only the atomic target/request API; same mastery writes zero times; failed writes remain visible in memory; retry clears the error; only `star-vocab-progress-v1` is written.

- [ ] **Step 7: Commit semantic state and all consumers together**

```bash
git add src/types.ts src/store/useStore.ts src/components/StarMap.tsx src/components/Sidebar.tsx src/components/Controls.tsx src/components/WordCard.tsx tests/unit/useStore.test.ts tests/components/navigationConsumers.test.tsx
git commit -m "feat: make navigation and progress atomic"
```

### Task 6: Define Immutable Renderer Contracts and Scene Snapshots

**Files:**
- Create: `src/render/contracts.ts`
- Create: `src/scene/createSceneSnapshot.ts`
- Create: `tests/unit/sceneSnapshot.test.ts`

- [ ] **Step 1: Write the RED snapshot and mutation tests**

Build a C0 snapshot at epoch 7 and assert exact counts, prefixed keys, empty Phase 1 portals, null Phase 1 orbits, complete word-card sidecars, and unchanged catalog fingerprints before and after a fake renderer compiles it. Also assert the navigate command preserves the exact `NavigationRequest` object and production mode refuses benchmark-only commands.

```ts
expect(snapshot.visibleCounts).toEqual({
  sectors: 0,
  roots: 72,
  portals: 0,
  words: 432,
  memberEdges: 432,
  wordRelationEdges: 251,
  overviewEdges: 0,
})
expect(snapshot.nodes.find((node) => node.key === 'word:inspect')).toMatchObject({
  kind: 'word',
  orbit: null,
})
```

- [ ] **Step 2: Run the RED contract test**

Run:

```bash
npm run test:unit -- tests/unit/sceneSnapshot.test.ts
```

Expected: FAIL because `src/render/contracts.ts` and the snapshot builder do not exist.

- [ ] **Step 3: Add the exact public renderer contract**

Define the seven-method interface without React or Zustand types:

```ts
export interface GraphRenderer {
  mount(host: HTMLElement, callbacks: RendererCallbacks): void
  loadScene(scene: SceneSnapshot, options: { signal: AbortSignal }): Promise<void>
  applyPatch(patch: ScenePatch): void
  execute(command: RendererCommand): void
  resize(width: number, height: number): void
  getMetrics(): RendererMetrics
  dispose(): Promise<void>
}
```

Define `ScenePatch` as the discriminated union `mastery | bloom`, each with `viewEpoch`. Define `RendererCommand` as:

```ts
export type RendererCommand =
  | { kind: 'navigate'; viewEpoch: number; request: NavigationRequest }
  | { kind: 'set-quality-ceiling'; viewEpoch: number; ceiling: 'high' | 'balanced' | 'low' }
  | { kind: 'set-locked-quality'; viewEpoch: number; quality: 'high' | 'balanced' | 'low' | 'low-no-particles' | 'minimal' | null }
  | { kind: 'benchmark-set-animation-time'; viewEpoch: number; timeMs: number | null }
  | { kind: 'benchmark-set-synthetic-renderer-work'; viewEpoch: number; workMs: number | null }
```

The navigate command carries the Store's immutable envelope, including original pointer/keyboard `eventTimeStamp`, without reconstructing timing downstream. The two `benchmark-*` variants are reserved now so Task 14 does not widen the renderer contract later. They execute only when the renderer was built with `VITE_STAR_BENCHMARK=1`; a normal build must reject them with `RendererCommandUnavailableError` and must expose no window facade that can issue them.

- [ ] **Step 4: Fix the complete snapshot shape for later phases**

Use these stable fields:

```ts
export interface SceneSnapshot {
  readonly catalogVersion: string
  readonly layoutVersion: string
  readonly viewEpoch: number
  readonly target: ViewTarget
  readonly nodes: readonly SceneNode[]
  readonly edges: readonly SceneEdge[]
  readonly indexes: SceneIndexes
  readonly visibleCounts: VisibleCounts
  readonly sidecars: SceneSidecars
}

export interface WordOrbit {
  readonly radius: number
  readonly phase: number
  readonly inclination: number
  readonly ascendingNode: number
  readonly angularVelocity: number
}
```

`SceneNodeBase` contains `key`, `entityId`, `label`, optional `sublabel`, `color`, `size`, and `position: readonly [number, number, number] | null`. Phase 1 uses root and word variants; the word variant includes `rootId`, `mastery`, and `orbit: null`. Reserve sector, sector-portal, and root-portal variants now so Phase 2 extends data rather than changing the outer snapshot.

`SceneSidecars` contains frozen `portals` and `wordCards` records. A word-card entry contains a frozen `word`, `root`, and relations with stable relation ID, type, note, and target `{ wordId, word, rootId }`.

- [ ] **Step 5: Define callbacks, readiness details, and metrics**

`RendererCallbacks` contains `onIntent(intent, eventTimeStamp)`, `onFirstSceneFrame`, `onChainStart`, and `onFatal`. Pointer and keyboard adapters pass their original event timestamp to `onIntent`; Coordinator forwards it to Store `navigate` and receives the resulting `NavigationRequest`. `RendererMetrics` contains renderer info counts, visible counts, force tick count, quality ceiling/current state, self-reported DPR, actual Bloom/particle state, active rAF/listener counts, and separately named `presentIntervalMs` and `rendererWorkMs` arrays.

`createSceneSnapshot` uses `layoutVersion: 'runtime-force-v1'`, builds every Phase 1 word-card sidecar from validated catalog data, and never mutates the catalog or graph model.

- [ ] **Step 6: Verify the GREEN contract**

Run:

```bash
npm run test:unit -- tests/unit/sceneSnapshot.test.ts
npm run typecheck
```

Expected: exit 0; C0 counts match exactly; all raw catalog fingerprints remain unchanged; all sidecar relation targets resolve; navigation timing survives unchanged and benchmark commands are unavailable in a normal build.

- [ ] **Step 7: Commit the renderer boundary**

```bash
git add src/render/contracts.ts src/scene/createSceneSnapshot.ts tests/unit/sceneSnapshot.test.ts
git commit -m "feat: define immutable renderer scenes"
```

### Task 7: Coordinate Epochs, Abort, and Static Fallback Ownership

**Files:**
- Create: `src/render/createRenderer.ts`
- Create: `src/scene/createStaticCatalogSnapshot.ts`
- Create: `src/scene/SceneCoordinator.ts`
- Create: `tests/unit/SceneCoordinator.test.ts`

- [ ] **Step 1: Write RED latest-wins and disposal tests**

Use deferred fake repository and renderer promises. Start epoch 1, issue epoch 2 before epoch 1 settles, resolve epoch 1 last, and assert only epoch 2 reaches the current scene. Assert exactly one store subscription and this terminal sequence on terminal Coordinator disposal: abort pending load, await rejection settlement, then await renderer disposal.

```ts
expect(renderer.committedEpochs).toEqual([2])
expect(store.subscribeCalls).toBe(1)
expect(events).toEqual(['abort:2', 'settled:2', 'renderer:dispose'])
```

Also assert a no-WebGL capability returns a navigable static snapshot without constructing a renderer. After a ready canvas, trigger both `onFatal` and a synthetic `webglcontextlost`; in each case assert pending work is aborted, only the renderer is awaited/disposed, a current static snapshot is published, the Coordinator and its one Store subscription remain alive, and a Static `onIntent` produces the next static epoch without attempting to use the dead renderer.

- [ ] **Step 2: Run the RED coordinator test**

Run:

```bash
npm run test:unit -- tests/unit/SceneCoordinator.test.ts
```

Expected: FAIL because `SceneCoordinator` is missing.

- [ ] **Step 3: Add an async renderer loader boundary**

Create `src/render/createRenderer.ts`:

```ts
import type { GraphRenderer } from './contracts'

export type RendererLoader = () => Promise<GraphRenderer>

export const loadRenderer: RendererLoader = async () => {
  const { LegacyForceGraphRenderer } = await import('./LegacyForceGraphRenderer')
  return new LegacyForceGraphRenderer()
}
```

The coordinator accepts a `RendererLoader`; it never imports a concrete renderer. This boundary becomes the Phase 3 renderer selector without changing coordinator signatures.

- [ ] **Step 4: Implement coordinator ownership and one store subscription**

The constructor receives repository, bound store API, renderer loader, WebGL2 capability function, and host callbacks `showCanvas`, `showStatic(snapshot, onIntent, reason)`, and `onCatalogReady`.

On `start(host)`:

1. Subscribe once before loading so an intent cannot be lost.
2. Increment epoch and create an `AbortController`.
3. Load and validate catalog, build the graph model and scene snapshot.
4. If WebGL2 is unavailable, publish a static snapshot.
5. Otherwise await the renderer loader, mount it, show canvas, and await `loadScene`.
6. Ignore `AbortError`; on initial non-abort renderer failure, fully dispose only that renderer and publish static fallback.

On a ready Phase 1 scene, consume the Store's atomic `navigationRequest` and use `execute({ kind: 'navigate', viewEpoch: currentViewEpoch, request })`; mastery and Bloom changes use patches. Pass the exact frozen request object from Store rather than rebuilding it. A target change during initial load aborts and restarts the initial scene with the newer epoch. Do not reconstruct `eventTimeStamp` in the Coordinator.

Treat renderer `onFatal` and `webglcontextlost` after readiness exactly like an initial renderer failure: mark that renderer terminal, abort and settle its pending work, await `renderer.dispose()`, then publish `showStatic` for the latest target and reason. Do not call `SceneCoordinator.dispose()` for runtime fallback. The Coordinator retains the validated catalog, Store subscription, and epoch ownership; the `onIntent` passed to Static calls Store `navigate`, and each request publishes a fresh static snapshot. A later explicit app/unmount disposal is the only operation that tears down the Coordinator subscription.

- [ ] **Step 5: Implement static snapshot generation**

`createStaticCatalogSnapshot` must include catalog version, epoch, target, visible counts, navigable root and word items, no Phase 1 portals, and the selected word-card sidecar. It accepts only a validated catalog and target and returns a deeply frozen object.

- [ ] **Step 6: Verify lifecycle errors and latest-wins behavior**

Run:

```bash
npm run test:unit -- tests/unit/SceneCoordinator.test.ts
npm run typecheck
```

Expected: exit 0; epoch 1 cannot mutate renderer, camera, or static state after epoch 2 starts; fatal/context-loss fallback disposes renderer resources before showing Static but leaves one live Coordinator subscription; Static navigation advances the epoch; final Coordinator dispose leaves zero subscriptions and no unhandled rejection.

- [ ] **Step 7: Commit coordinator ownership**

```bash
git add src/render/createRenderer.ts src/scene/createStaticCatalogSnapshot.ts src/scene/SceneCoordinator.ts tests/unit/SceneCoordinator.test.ts
git commit -m "feat: coordinate atomic scene lifecycle"
```

### Task 8: Add the Single Frame Scheduler and Quality State Machine

**Files:**
- Create: `src/render/FrameScheduler.ts`
- Create: `src/render/qualityController.ts`
- Create: `tests/unit/FrameScheduler.test.ts`
- Create: `tests/unit/qualityController.test.ts`

- [ ] **Step 1: Write the RED scheduler tests**

Inject fake `requestAnimationFrame`, `cancelAnimationFrame`, and `performance.now`. Assert only one callback is pending, actual callback timestamps produce present intervals, frame-synchronous tasks run every frame, capped tasks honor their periods, hidden mode suppresses nonessential work, and dispose cancels the pending callback.

```ts
scheduler.addTask({ id: 'orbit', maxHz: 'frame', essential: true, run: orbit })
scheduler.addTask({ id: 'pulse', maxHz: 30, essential: false, run: pulse })
advanceRaf(120, 1000 / 60)
expect(orbit).toHaveBeenCalledTimes(120)
expect(pulse).toHaveBeenCalledTimes(60)
expect(scheduler.getPresentIntervals()[0]).toBeCloseTo(1000 / 60)
```

- [ ] **Step 2: Write the RED quality-boundary tests**

For high, balanced, and low, independently seed stable EWMA and assert:

- 1.19 times budget for 130 samples does not degrade.
- 1.21 times budget degrades exactly on sample 120 and only one state.
- 0.81 times the candidate upper-state budget for 310 samples does not recover.
- 0.79 times that budget recovers exactly on sample 300 and only one state.

Add full descent and reverse recovery matrices for high, balanced, and low ceilings, including low-no-particles and minimal at the 33.3 ms budget.

- [ ] **Step 3: Run both RED suites**

Run:

```bash
npm run test:unit -- tests/unit/FrameScheduler.test.ts tests/unit/qualityController.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement the one-rAF scheduler**

`FrameScheduler` owns the only production rAF. Each callback:

1. Stores the exact rAF timestamp and derives `presentIntervalMs` from the preceding timestamp.
2. Starts the renderer-work timer.
3. Runs due tasks in deterministic registration order.
4. Runs the renderer/composer submission callback.
5. Records real `rendererWorkMs`, or a benchmark-only injected work sample before EWMA update.
6. Requests exactly one next frame.

Use bounded sample buffers of 40,000 entries. `setHidden(true)` pauses background, pulse, relation-breathe, and meteor tasks while allowing an in-progress first-scene commit to render.

- [ ] **Step 5: Implement the five-state quality controller**

Use this exact ordered configuration:

```ts
export const QUALITY_STATES = {
  high: { dpr: 1.75, particles: true, bloom: true, budgetMs: 16.7 },
  balanced: { dpr: 1.25, particles: true, bloom: true, budgetMs: 20 },
  low: { dpr: 1, particles: true, bloom: true, budgetMs: 33.3 },
  'low-no-particles': { dpr: 1, particles: false, bloom: true, budgetMs: 33.3 },
  minimal: { dpr: 1, particles: false, bloom: false, budgetMs: 33.3 },
} as const
```

Transitions use renderer-work EWMA only. Degrade after 120 consecutive samples strictly above 1.2 times current budget; recover after 300 consecutive samples strictly below 0.8 times the candidate upper-state budget. Reset the relevant counter on a state change, opposite-threshold crossing, or hysteresis-band sample. Locked quality records samples but never transitions. Recovery never exceeds the user's ceiling.

- [ ] **Step 6: Verify scheduler and quality GREEN behavior**

Run:

```bash
npm run test:unit -- tests/unit/FrameScheduler.test.ts tests/unit/qualityController.test.ts
npm run typecheck
```

Expected: exit 0; all boundary sample numbers match exactly; scheduler active-rAF count returns to zero after disposal.

- [ ] **Step 7: Commit the reusable controllers**

```bash
git add src/render/FrameScheduler.ts src/render/qualityController.ts tests/unit/FrameScheduler.test.ts tests/unit/qualityController.test.ts
git commit -m "feat: add frame and quality controllers"
```

### Task 9: Build the Imperative Legacy Runtime with Atomic Staging

**Files:**
- Modify: `src/lib/threeNode.ts`
- Create: `src/render/resourceRegistry.ts`
- Create: `src/render/graphRuntime.ts`
- Create: `src/render/LegacyForceGraphRenderer.ts`
- Create: `tests/unit/resourceRegistry.test.ts`
- Create: `tests/unit/graphRuntime.test.ts`
- Create: `tests/unit/LegacyForceGraphRenderer.test.ts`

- [ ] **Step 1: Write RED idempotent resource tests**

Track duplicate fake geometry, texture, material, pass, and listener disposables. Assert each resource is disposed once, named listener cleanup runs once, registry metrics reach zero, and a second registry disposal is a no-op.

- [ ] **Step 2: Write RED runtime lifecycle tests**

Inject renderer, controls, composer, Bloom-pass, and scheduler factories. Assert one canvas/context, one Bloom pass, one listener per controls event, one `webglcontextlost` listener that prevents the browser default and forwards `onFatal` exactly once, named background objects once, and this cleanup set:

```ts
expect(composer.removePass).toHaveBeenCalledWith(bloom)
expect(bloom.dispose).toHaveBeenCalledTimes(1)
expect(controls.dispose).toHaveBeenCalledTimes(1)
expect(renderer.dispose).toHaveBeenCalledTimes(1)
expect(metrics.activeRafCount).toBe(0)
expect(metrics.activeListenerCount).toBe(0)
```

- [ ] **Step 3: Write RED renderer atomicity tests**

Use fake graph groups and frame acknowledgements to cover staging abort before commit, abort after swap but before first frame, non-abort first-frame failure rollback, concurrent latest-token wins, stale patch rejection, and disposal during load. After dispose, `loadScene` rejects and `applyPatch`/`execute` throw `RendererLifecycleError`.

- [ ] **Step 4: Run all RED runtime suites**

Run:

```bash
npm run test:unit -- tests/unit/resourceRegistry.test.ts tests/unit/graphRuntime.test.ts tests/unit/LegacyForceGraphRenderer.test.ts
```

Expected: FAIL because the three runtime modules do not exist.

- [ ] **Step 5: Make node resources explicitly scene-owned**

Replace module-global texture ownership in `threeNode.ts` with a `SceneResourceRegistry` passed to `createNodeObject`. One scene registry owns its glow, spark, ring, label textures, geometries, and materials. Old and staging scenes must not share disposable textures, so releasing the old graph cannot invalidate the staging graph.

Keep raw visual semantics: root wireframe, core, glow, label and subtitle; word core, glow, label; mastery and exploration colors. Add a typed node user-data record rather than reading arbitrary fields through `any` outside the ForceGraph adapter.

- [ ] **Step 6: Implement the single-context Three runtime**

`graphRuntime.ts` owns one `WebGLRenderer`, `Scene`, `PerspectiveCamera`, `TrackballControls`, `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `FrameScheduler`, background registry, pointer listeners, and context-loss listener. It exposes methods to add/hide/remove a graph group, render, resize, apply quality, resolve picking, inspect metrics, report fatal/context-loss once, and dispose.

Use `three-forcegraph` directly, not the `3d-force-graph` outer renderer. The outer package owns a private rAF and destroys current graph objects on replacement; using the core's public `tickFrame()` lets this runtime satisfy the one-scheduler and retained-old-scene requirements.

- [ ] **Step 7: Implement Legacy renderer staging and atomic first frame**

For every load:

1. Increment an internal load token and create a scene-local registry.
2. Clone immutable nodes and edges into ForceGraph-owned mutable records.
3. Configure an off-scene `ThreeForceGraph` and await its `onFinishUpdate` acknowledgement.
4. Recheck token, epoch, and signal before swap.
5. Add the staging group to the one runtime scene, hide but retain the old group, and make staging current.
6. Wait for a scheduler frame whose epoch and visible counts match the snapshot.
7. Recheck token, epoch, and signal; resolve and dispose the old group only after that frame.
8. On abort or first-frame failure, remove/dispose staging, restore the old group, and reject.

Initial parity mode accepts `legacyForceOrbit: true`; Task 11 changes the default after direct orbit updates exist. Renderer code imports neither React nor Zustand.

- [ ] **Step 8: Implement complete renderer disposal**

Set lifecycle to disposing before aborting loads. Await every tracked load settlement, clear each graph with `graphData({ nodes: [], links: [] })`, call `resetProps`, dispose its scene registry, then dispose the shared runtime. Clear body cursor and all host children. Return a frozen metrics copy from `getMetrics`.

- [ ] **Step 9: Verify runtime and renderer GREEN behavior**

Run:

```bash
npm run test:unit -- tests/unit/resourceRegistry.test.ts tests/unit/graphRuntime.test.ts tests/unit/LegacyForceGraphRenderer.test.ts
npm run typecheck
```

Expected: exit 0; the fake runtime never owns more than one context or scheduler; rollback restores the previous scene; all pending promises settle before disposal resolves.

- [ ] **Step 10: Commit the imperative renderer**

```bash
git add src/lib/threeNode.ts src/render/resourceRegistry.ts src/render/graphRuntime.ts src/render/LegacyForceGraphRenderer.ts tests/unit/resourceRegistry.test.ts tests/unit/graphRuntime.test.ts tests/unit/LegacyForceGraphRenderer.test.ts
git commit -m "refactor: wrap legacy force graph runtime"
```

### Task 10: Add the Static View, Thin Host, and Lazy React Shell

**Files:**
- Modify: `index.html`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/index.css`
- Modify: `src/components/Controls.tsx`
- Modify: `src/components/Hud.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/StarMap.tsx`
- Modify: `src/components/WordCard.tsx`
- Create: `src/components/StaticCatalogView.tsx`
- Create: `src/components/loadStarMap.ts`
- Create: `src/perf/marks.ts`
- Create: `tests/components/StaticCatalogView.test.tsx`
- Create: `tests/components/StarMap.test.tsx`
- Create: `tests/components/App.test.tsx`

- [ ] **Step 1: Write RED static readiness and navigation tests**

Render a frozen static snapshot, flush one rAF, and assert `fallback-ready` appears only after root and word navigation elements are committed. Click a root and word and assert exact intents are returned through `onIntent`; assert the component never imports or calls the repository/store.

- [ ] **Step 2: Write RED StrictMode host tests**

Render `StarMap` inside `StrictMode` with fake coordinators whose first `dispose()` is deliberately deferred. Assert the replacement coordinator does not call `start()` until that disposal settles, every created coordinator is disposed, maximum concurrently mounted renderer count is one, ResizeObserver delivers the latest buffered size only to the active coordinator, and no Store selector is invoked from `StarMap`. Reject a fake `start()` once and assert cleanup still serializes without an unhandled rejection.

- [ ] **Step 3: Write RED shell and repeated-word tests**

Render `App` with a deferred repository. Assert header, sidebar search, and controls exist before catalog resolution; `shell-ready` fires after commit plus rAF; the 3D loader starts only after that mark. Re-run the Task 5 repeated-word flow through the assembled shell and assert request sequence/nonce advances without a timeout-clear transition.

- [ ] **Step 4: Run the RED component suites**

Run:

```bash
npm run test:unit -- tests/components/StaticCatalogView.test.tsx tests/components/StarMap.test.tsx tests/components/App.test.tsx
```

Expected: FAIL because the static component and lazy loader do not exist and current `App` blocks the shell on data.

- [ ] **Step 5: Add exact application performance marks**

Before the module script in `index.html`, execute:

```html
<script>
  performance.mark('app-start', { startTime: 0 })
</script>
```

`src/perf/marks.ts` exports typed wrappers for `shell-ready`, `data-ready`, `first-scene-frame`, `fallback-ready`, `layout-ready`, `cluster-visible`, `card-painted`, and `chain-start`. Marks that describe a scene carry catalog version, view epoch, and exact visible counts.

- [ ] **Step 6: Implement StaticCatalogView readiness**

The component accepts only `{ snapshot, reason, onIntent }`. It renders navigable sector/root/word/portal items from the snapshot and the selected word card. `onIntent(intent, eventTimeStamp)` returns the original DOM event timestamp to the still-live Coordinator. In `useLayoutEffect`, schedule one rAF, verify the rendered catalog/epoch attributes and navigation count, then mark `fallback-ready`. Cancel the rAF on cleanup.

- [ ] **Step 7: Reduce StarMap to a memoized host**

`StarMap` accepts the shared repository and optional renderer loader, creates one coordinator per effect lifetime, supplies `showCanvas` and `showStatic`, and observes host size. Because React effect cleanup cannot itself be awaited, keep a per-component `lifecycleTail` promise in a ref: each effect queues `start(host)` only after the previous tail settles, and cleanup synchronously marks that lifetime cancelled, disconnects its observer, and replaces the tail with a caught/awaited `start` settlement followed by terminal `coordinator.dispose()`. A queued lifetime that was cancelled before its turn disposes without starting. Buffer the latest observed size and deliver it only after that lifetime starts; ignore callbacks after cancellation. This serialization must survive StrictMode's setup-cleanup-setup cycle, prevent overlapping renderers, and leave no rejected promise unhandled. `StarMap` does not subscribe to Zustand, read repository data, import Three, or manipulate scene objects.

Keep the canvas host mounted while switching display modes. For no-WebGL, `onFatal`, or context loss, render `StaticCatalogView` only after the failed renderer's `dispose()` has completed and a static snapshot is available; the Coordinator itself remains alive and owns Static navigation.

- [ ] **Step 8: Render the shell before data and lazily load 3D**

`loadStarMap.ts` memoizes one `import('./StarMap')` promise and exports both the React lazy component and `preloadStarMap`. `App` renders header/sidebar/control structure with empty arrays immediately, loads catalog through one shared repository, marks `data-ready` after validation, and starts the lazy 3D import only after the `shell-ready` rAF or an idle preload.

Do not put Three, ForceGraph, repository validation, or renderer contracts in the initial component module graph unless the shell directly needs the type at compile time.

- [ ] **Step 9: Narrow UI subscriptions without reopening the navigation migration**

Task 5 has already replaced independent word/root actions and removed both delayed navigation timers. Keep that API intact here; this task only narrows subscriptions and connects readiness marks. Any reintroduction of duplicate target fields or timeouts is a regression.

Split a memoized `WordRow` whose selector reads only its word's mastery and active target. Parent Sidebar subscribes only to query and the minimal progress revision needed by the active filter. Display `persistenceError` with a retry button. `WordCard` marks `card-painted` after its target word has committed and one rAF has elapsed.

- [ ] **Step 10: Verify component GREEN behavior and lazy chunks**

Run:

```bash
npm run test:unit -- tests/components/StaticCatalogView.test.tsx tests/components/StarMap.test.tsx tests/components/App.test.tsx
npm run typecheck
npm run typecheck:test
npm run build
```

Expected: all commands exit 0; Vite emits a small entry plus at least one separate StarMap/renderer chunk; StrictMode tests leave zero live coordinators after cleanup.

- [ ] **Step 11: Commit the React boundary**

```bash
git add index.html src/App.tsx src/main.tsx src/index.css src/components/Controls.tsx src/components/Hud.tsx src/components/Sidebar.tsx src/components/StarMap.tsx src/components/WordCard.tsx src/components/StaticCatalogView.tsx src/components/loadStarMap.ts src/perf/marks.ts tests/components/StaticCatalogView.test.tsx tests/components/StarMap.test.tsx tests/components/App.test.tsx
git commit -m "perf: lazy load resilient star map shell"
```

### Task 11: Stop D3 and Update Only the Active Orbit

**Files:**
- Modify: `src/render/LegacyForceGraphRenderer.ts`
- Modify: `src/render/graphRuntime.ts`
- Create: `tests/unit/localOrbit.test.ts`
- Create: `tests/browser/orbit.spec.ts`

- [ ] **Step 1: Write the RED zero-tick orbit test**

Build a graph with two roots, two words under each root, member edges, and one cross-root relation. Complete initial layout, focus the first root, advance 600 frames, and assert:

```ts
expect(metrics.forceTickCount - ticksAtLayoutReady).toBe(0)
expect(changedNodeKeys).toEqual(['word:inspect', 'word:prospect'])
expect(changedEdgeKeys.sort()).toEqual(expectedAffectedEdgeKeys.sort())
expect(unchangedRootFingerprint).toBe(beforeRootFingerprint)
expect(dynamicOrbitLines.every((line) => line.frustumCulled === false)).toBe(true)
```

The browser test observes overview for 10 seconds, enters root focus, observes another 10 seconds, and checks tick delta zero while node and edge endpoint pixels move. Move the camera so the focused orbit crosses its original line bounds and assert affected lines remain visible.

- [ ] **Step 2: Run the RED orbit tests**

Run:

```bash
npm run test:unit -- tests/unit/localOrbit.test.ts
```

Expected: FAIL because parity mode reheats D3 or lacks direct edge updates.

- [ ] **Step 3: Stop force simulation after initial layout**

Use finite initial `cooldownTicks` and `cooldownTime`; never set either to Infinity. On engine stop, record `layout-ready`, pin each final `x/y/z` to `fx/fy/fz`, cache center and animation objects, and leave the force engine stopped. Focusing a root must not call `d3ReheatSimulation` in the default path.

- [ ] **Step 4: Implement indexed local orbit updates**

At focus start, derive stable orbit basis vectors from the current word offsets and raw IDs. Every scheduler frame visits only `orbitNodeIndicesByRootId.get(rootId)` and writes node coordinates plus `__threeObj.position`.

Visit only `orbitEdgeIndicesByRootId.get(rootId)`. For a straight line, update the six floats in its position attribute from current source and target coordinates and set `needsUpdate = true`. Mark only these dynamically updated orbit lines `frustumCulled = false` when their renderer objects are created; static lines retain normal culling. This avoids stale bounding spheres hiding moving lines without paying to recompute a sphere for every line on every frame. Keep the comparison switch path that reheats D3 only when `legacyForceOrbit` is explicitly enabled.

- [ ] **Step 5: Make the direct orbit path the default**

Default `legacyForceOrbit` to false. Permit benchmark query `?legacyForceOrbit=1` only for comparison. Expose the active path and force tick counter in renderer metrics so tests cannot pass while the legacy path is active accidentally.

- [ ] **Step 6: Verify zero ticks and synchronized endpoints**

Run:

```bash
npm run test:unit -- tests/unit/localOrbit.test.ts
npm run build:benchmark
npm run test:browser -- tests/browser/orbit.spec.ts --project=desktop
```

Expected: exit 0; both 10-second windows have zero post-layout ticks; focused words and exactly their indexed edges move; dynamic lines remain visible outside their original bounds with culling disabled; the rest of the graph remains fixed.

- [ ] **Step 7: Commit the force-stop boundary**

```bash
git add src/render/LegacyForceGraphRenderer.ts src/render/graphRuntime.ts tests/unit/localOrbit.test.ts tests/browser/orbit.spec.ts
git commit -m "perf: stop force ticks during local orbit"
```

### Task 12: Cap Labels, Particles, and Effect Cadence

**Files:**
- Modify: `src/lib/threeNode.ts`
- Modify: `src/render/LegacyForceGraphRenderer.ts`
- Modify: `src/render/graphRuntime.ts`
- Create: `tests/unit/sceneEffects.test.ts`

- [ ] **Step 1: Write the RED label and particle tests**

Assert word labels are hidden in overview, a hovered label is visible, selection shows selected and relation-neighbor labels, clearing selection hides them, and only active chain relations emit particles when the current quality state permits particles.

```ts
expect(labelVisible('word:inspect')).toBe(false)
hover('word:inspect')
expect(labelVisible('word:inspect')).toBe(true)
navigateToWord('inspect')
expect(visibleWordLabelKeys()).toEqual(['word:inspect', 'word:prospect'])
expect(particleRelationKeys()).toEqual(incidentRelationKeys)
```

- [ ] **Step 2: Write the RED cadence and visibility tests**

Advance 120 frames at 60 Hz. Assert orbit and camera tasks run 120 times, pulse runs 60 times, relation breathing runs 24 times, and hidden mode runs zero background/pulse/breathe/meteor updates. The scene-load first-frame task remains able to complete while hidden.

- [ ] **Step 3: Run the RED effects test**

Run:

```bash
npm run test:unit -- tests/unit/sceneEffects.test.ts
```

Expected: FAIL because current label state does not toggle visibility and effects run every frame.

- [ ] **Step 4: Make label state explicit and incremental**

Store label sprite references in typed node user data. A root label remains visible. A word label is visible only when hovered, selected, or a relation neighbor. On target changes, update the union of old and new selected/neighbor node indexes; on mastery changes, update only the patched word. Do not traverse all nodes for a single mastery patch.

- [ ] **Step 5: Remove ordinary permanent particles**

Configure `linkDirectionalParticles(0)` for normal relations. While a chain is active and quality permits particles, emit transient particles only for incident relation indexes at the capped chain cadence. Clearing selection or entering a particle-disabled quality state stops emissions immediately.

- [ ] **Step 6: Register exact scheduler cadences and hidden behavior**

Register camera and local orbit at frame cadence, node pulse at 30 Hz, relation breathing at 12 Hz, and background/meteor work as nonessential. Use `visibilitychange` to call scheduler hidden mode; remove the named document listener on runtime disposal.

- [ ] **Step 7: Verify GREEN visual workload behavior**

Run:

```bash
npm run test:unit -- tests/unit/sceneEffects.test.ts
npm run typecheck
```

Expected: exit 0; exact 120/60/24 call counts pass; no ordinary relation owns a permanent particle group; hidden nonessential counters remain unchanged.

- [ ] **Step 8: Commit the effect-policy boundary**

```bash
git add src/lib/threeNode.ts src/render/LegacyForceGraphRenderer.ts src/render/graphRuntime.ts tests/unit/sceneEffects.test.ts
git commit -m "perf: cap legacy scene effects"
```

### Task 13: Apply DPR, Bloom, and Adaptive Quality Atomically

**Files:**
- Modify: `src/store/useStore.ts`
- Modify: `src/components/Controls.tsx`
- Modify: `src/render/graphRuntime.ts`
- Modify: `src/render/LegacyForceGraphRenderer.ts`
- Modify: `src/scene/SceneCoordinator.ts`
- Create: `tests/unit/renderQualityIntegration.test.ts`
- Create: `tests/components/Controls.test.tsx`

- [ ] **Step 1: Write RED runtime quality integration tests**

Assert each quality state applies its exact DPR cap, particle permission, and Bloom permission in one transition. Assert actual Bloom is `userBloomEnabled && qualityAllowsBloom`; user-off Bloom stays off after quality recovery. Assert locked quality never transitions and a user ceiling cannot be exceeded.

```ts
runtime.applyQuality('balanced', true)
expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1.25)
expect(runtime.getMetrics()).toMatchObject({
  qualityState: 'balanced',
  bloomEnabled: true,
  particlesEnabled: true,
})
```

- [ ] **Step 2: Write the RED quality control test**

Render controls and assert the high/balanced/low segmented control issues one `setQualityCeiling` action, exposes selection through `aria-pressed`, and does not directly call renderer code.

- [ ] **Step 3: Run the RED quality tests**

Run:

```bash
npm run test:unit -- tests/unit/renderQualityIntegration.test.ts tests/components/Controls.test.tsx
```

Expected: FAIL because runtime quality is not wired to renderer or UI.

- [ ] **Step 4: Route user quality through semantic state and coordinator**

Store `qualityCeiling` and a same-value-short-circuiting setter. Render a three-option segmented control in `Controls`. Coordinator observes the ceiling through its one existing subscription and sends `set-quality-ceiling` with current epoch. Bloom remains a separate user preference patch.

- [ ] **Step 5: Apply a quality state as one runtime operation**

In one method, set pixel ratio to `min(window.devicePixelRatio, preset.dpr)`, reapply renderer/composer size, update particle permission, and set Bloom to `userBloomEnabled && preset.bloom`. Do not create an implicit sixth quality combination.

After every frame submission, feed real renderer work into `QualityController`; `presentIntervalMs` never enters EWMA. In benchmark builds only, permit `syntheticRendererWorkMs` to replace the sample immediately before EWMA update without busy waiting.

- [ ] **Step 6: Report actual DPR from the drawing buffer**

Metrics self-report width and height ratios from `renderer.getDrawingBufferSize()` divided by the canvas CSS rect. This self-report is diagnostic only; Task 14 independently reads the WebGL context drawing buffer.

- [ ] **Step 7: Verify GREEN quality integration**

Run:

```bash
npm run test:unit -- tests/unit/renderQualityIntegration.test.ts tests/components/Controls.test.tsx tests/unit/qualityController.test.ts
npm run typecheck
```

Expected: exit 0; transitions do not skip states; user Bloom remains authoritative; all runtime resources still return to zero after disposal.

- [ ] **Step 8: Commit adaptive rendering quality**

```bash
git add src/store/useStore.ts src/components/Controls.tsx src/render/graphRuntime.ts src/render/LegacyForceGraphRenderer.ts src/scene/SceneCoordinator.ts tests/unit/renderQualityIntegration.test.ts tests/components/Controls.test.tsx
git commit -m "perf: add adaptive render quality"
```

### Task 14: Enforce Bundle, Browser, Lifecycle, and Performance Gates

**Files:**
- Modify: `package.json`
- Modify: `playwright.config.ts`
- Modify: `vite.config.ts`
- Modify: `scripts/perf-server.mjs`
- Modify: `src/perf/marks.ts`
- Modify: `src/components/StarMap.tsx`
- Modify: `src/components/StaticCatalogView.tsx`
- Modify: `src/components/WordCard.tsx`
- Modify: `src/render/LegacyForceGraphRenderer.ts`
- Create: `src/perf/testApi.ts`
- Create: `playwright.perf.config.ts`
- Create: `scripts/check-bundle.mjs`
- Create: `scripts/precompress.mjs`
- Create: `scripts/run-phase1-d3.mjs`
- Create: `scripts/run-phase1-rollback.mjs`
- Create: `scripts/verify-phase1-release.mjs`
- Create: `tests/perf/fixtures.ts`
- Create: `tests/perf/perf.ts`
- Create: `tests/perf/environment.ts`
- Create: `tests/perf/phase1.cold-start.spec.ts`
- Create: `tests/perf/phase1.runtime.spec.ts`
- Create: `tests/perf/phase1.persistence.spec.ts`
- Create: `tests/perf/phase1.rollback.spec.ts`
- Create: `tests/browser/phase1.spec.ts`
- Create: `tests/browser/phase1.visual.spec.ts`
- Create: `tests/browser/phase1.visual.spec.ts-snapshots/phase1-desktop-darwin.png`
- Create: `tests/browser/phase1.visual.spec.ts-snapshots/phase1-mobile-viewport-darwin.png`

- [ ] **Step 1: Write the RED bundle-budget test command**

Run:

```bash
npm run perf:bundle
```

Expected: npm exits 1 with `Missing script: "perf:bundle"`.

- [ ] **Step 2: Write RED browser lifecycle and interaction specs**

Cover production shell/data/first-frame marks, canvas non-background pixels, drag, zoom, word navigation, root orbit, relation chain, Bloom, progress repaint, persistence failure/retry, no-WebGL static navigation, runtime `onFatal`, WebGL context loss, 10 production mount/unmount cycles, and development StrictMode.

The readiness assertion must compare `first-scene-frame.detail` against the complete target snapshot counts; a nonblank canvas alone is insufficient. `card-painted` and `chain-start` must follow the original `NavigationRequest.eventTimeStamp` and verified committed React/renderer frames. Static fallback tests assert the renderer reaches zero owned resources before `fallback-ready`, the Coordinator remains subscribed, and Static navigation publishes a newer epoch.

Cold-start specs use one warm-up plus 30 fresh contexts per profile and nearest-rank percentiles. Encode these hard budgets directly in assertions:

| Profile | `navigationStart -> shell-ready` p75 / p95 | `navigationStart -> first-scene-frame` p75 / p95 |
|---|---:|---:|
| D1 | 500 ms / 800 ms | 2,000 ms / 3,000 ms |
| D2 | 1,200 ms / 2,000 ms | 4,000 ms / 6,000 ms |

The bytes received before the matching first scene frame must include HTML, CSS, every requested JS chunk, and `roots.json`/`words.json`/`wordlinks.json`; their deterministic gzip sum is at most 650 KiB, and CDP `encodedDataLength` is at most 105 percent of that static budget.

- [ ] **Step 3: Write RED deterministic fixture and quality-soak specs**

`tests/perf/fixtures.ts` creates fixed-seed C0, C0_COMPARE, and C2 without self-edges or duplicate edges and reports nodes, edges, maximum degree, and density. Runtime specs independently check drawing-buffer DPR, D3 tick delta, the complete adaptive threshold matrix, and renderer resource plateaus.

On score-eligible D1 at 1440x900, device DPR 2, locked high, independently verified actual DPR 1.75, Bloom on, and relation particles on, warm each C0 animation scene for 5 seconds and sample for 30 seconds three times. Overview, selected-word, and focused-root each require median FPS at least 50 and nearest-rank p95 `presentIntervalMs` at most 33.3 ms, with no quality transition. `rendererWorkMs` is forbidden from FPS and percentile calculations. Word-card and relation-chain visual feedback each require p95 at most 100 ms from the original event timestamp.

Run C0_COMPARE on the pre-change report and candidate with the same score-eligible D1 signature, 1440x900, actual DPR 1.25, Bloom/particles on, auto quality off, fixed camera, word, root, and relation-chain script. Focused-scene p95 `presentIntervalMs` must improve by at least 25 percent versus `phase0-c0.json` or be at most 20 ms. Signature or script mismatch makes the relative result invalid rather than passing.

Persistence specs perform 100 synchronous writes, preserve `star-vocab-progress-v1`, verify the pure record payload, and report nearest-rank p95 and maximum durations. A score-eligible run requires p95 at most 8 ms; the current report records values as non-scoring. Ten mount/unmount cycles must return renderer-owned geometry, texture, listener, rAF, and named-scene-object counts to zero and keep the WebGL context count at one while mounted.

- [ ] **Step 4: Run the RED browser/performance specs**

Run:

```bash
npm run test:browser -- tests/browser/phase1.spec.ts --project=desktop
npm run perf:phase1
```

Expected: FAIL because the production benchmark API, precompressed server, and `perf:phase1` script are absent.

- [ ] **Step 5: Add manifest-based fixed-gzip bundle accounting**

Enable Vite build manifest output. `scripts/check-bundle.mjs` reads `.vite/manifest.json`, follows static imports from `index.html`, and computes gzip level 9 with fixed mtime 0. It exits nonzero unless:

- Initial entry plus static imports are at most 120 KiB gzip.
- All production JS, including lazy 3D chunks, is at most 430 KiB gzip.
- No initial static import reaches `three`, `three-forcegraph`, `three-spritetext`, or `LegacyForceGraphRenderer`.

Add scripts:

```json
{
  "perf:bundle": "node scripts/check-bundle.mjs",
  "perf:precompress": "node scripts/precompress.mjs",
  "perf:phase1": "playwright test -c playwright.perf.config.ts tests/perf/phase1.cold-start.spec.ts tests/perf/phase1.runtime.spec.ts tests/perf/phase1.persistence.spec.ts",
  "perf:phase1:d3": "node scripts/run-phase1-d3.mjs",
  "perf:phase1:rollback": "node scripts/run-phase1-rollback.mjs",
  "verify:phase1-release": "node scripts/verify-phase1-release.mjs"
}
```

Create `playwright.perf.config.ts` as the single production-performance configuration. It uses the same `benchmark:serve` web server, headed system Chrome, one worker, zero retries, and projects `D1`, `D2`, and `D3`. D1 fixes 1440x900 and device DPR 2; D2 fixes 1365x768, DPR 1, CPU 4x, 5 Mbps, and 100 ms RTT; D3 is invoked only by `run-phase1-d3.mjs` after a real Pixel 7a preflight. `tests/perf/perf.ts` owns nearest-rank percentile and adjacent-rAF helpers, while `tests/perf/environment.ts` owns the shared environment signature and score-eligibility checks used by later phases.

- [ ] **Step 6: Upgrade the benchmark server to production protocol**

`scripts/precompress.mjs` creates deterministic `.gz` siblings for built HTML/CSS/JS/JSON. `perf-server.mjs` serves those bytes with `Content-Encoding: gzip`, correct content type, `Vary: Accept-Encoding`, no-cache HTML and monolith JSON, and one-year immutable cache for hashed assets. Reject traversal and unsupported methods.

Cold-start tests reuse one ready server, create one warm-up plus 30 fresh contexts per profile, clear origin storage and browser cache, then inject only the fixed progress fixture. D2 applies DPR 1, CPU 4x, 5 Mbps, and 100 ms RTT through CDP.

- [ ] **Step 7: Expose the benchmark-only read surface**

Only when `VITE_STAR_BENCHMARK=1`, expose a frozen `window.__STAR_PERF__` facade whose getters return copies of renderer info, visible counts, force ticks, quality ceiling/current, actual-DPR self-report, Bloom/particle state, active rAF/listener counts, and separate sample arrays. Include explicit test controls for locked quality, fixed animation time, and synthetic renderer-work injection; none exist in a normal production build.

The browser test independently computes actual DPR from `canvas.getBoundingClientRect()` and the real WebGL `drawingBufferWidth/Height`, requiring each dimension to be within 1 px of rounded CSS size times preset DPR.

- [ ] **Step 8: Implement exact mark and interaction assertions**

Ensure `first-scene-frame`, `fallback-ready`, `layout-ready`, `cluster-visible`, `card-painted`, and `chain-start` are emitted at their specified commit/frame boundaries with epoch and counts. Interaction latency starts at the raw event `timeStamp`; state-function completion is not accepted as visual feedback.

The visual spec uses fixed seed, fixed camera, frozen animation time, and TTS disabled. Capture desktop 1440x900 and mobile viewport 915x412 snapshots, and perform a canvas pixel histogram check before screenshot comparison.

- [ ] **Step 9: Encode scoring eligibility instead of fabricating device results**

Environment collection must refuse scoring unless D1/D2 are at 60 Hz, connected to power, low-power mode off, and thermal nominal, with complete executable/major, OS, and WebGL signature. Probe these fields immediately before and after every run; never reuse the earlier battery observation. When any requirement is ineligible, write a report such as:

```json
{
  "scoreEligible": false,
  "status": "gates-built-non-scoring",
  "numericBudgetsClaimed": false
}
```

Probe D3 with `command -v adb`. In the current environment the command has no path, so record `{"device":"D3","status":"skipped","reason":"no-adb"}`. Do not add a generated FPS value or a passing D3 flag.

`run-phase1-rollback.mjs` must build the candidate, read the exact `sourceCommit`, `sourceTree`, and lock digest from `artifacts/perf/phase0-c0.json`, verify that commit is an ancestor of the candidate and still resolves to the recorded tree, then restore it in an isolated temporary worktree. It serves baseline and candidate production artifacts in turn and runs `phase1.rollback.spec.ts` against the same fixed progress fixture. No Git tag is assumed or created. It verifies that both builds read `star-vocab-progress-v1` without migration and that returning to the candidate restores navigation. `verify-phase1-release.mjs` fails closed unless the original baseline and immutable source provenance exist, all non-device gates pass, D1/D2 reports are score-eligible and satisfy every absolute and relative budget, and the rollback evidence succeeds. It records D3 as unavailable for Phase 1 rather than converting `skipped` into `passed`; Phase 2 still has its own mandatory real-D3 completion gate before Phase 3 can start.

- [ ] **Step 10: Run all valid local gates**

Run each command separately:

```bash
npm run build
npm run perf:bundle
npm run test:unit
npm run build:benchmark
npm run perf:precompress
npm run test:browser -- tests/browser/phase1.spec.ts tests/browser/phase1.visual.spec.ts --project=desktop
npm run test:browser -- tests/browser/phase1.spec.ts tests/browser/phase1.visual.spec.ts --project=mobile-viewport
npm run perf:phase1 -- --project=D1 --project=D2
npm run perf:phase1:d3
npm run perf:phase1:rollback
```

Expected now: build, bundle, unit, functional browser, visual, lifecycle, and protocol checks pass. `perf:phase1:d3` probes the real-device path and, when `adb` is absent, exits successfully only after writing explicit `skipped: no-adb` evidence with no synthetic metrics. D1/D2 scoring status comes only from the live environment probes: an eligible run must enforce all numeric gates, while an ineligible diagnostic must show `scoreEligible: false` and make no numeric budget claim.

- [ ] **Step 11: Preserve the validation switch until a score-eligible run passes**

Do not remove `legacyForceOrbit` after any non-scoring run. On the first eligible D1/D2 run, execute the same fixed C0_COMPARE script with `legacyForceOrbit=1` and `legacyForceOrbit=0`, run the rollback drill, and then run `npm run verify:phase1-release`. Remove the switch only when the new path improves focused-scene p95 by at least 25 percent or reaches 20 ms, all absolute Phase 1 gates pass, the report signature is eligible, and the release verifier exits 0.

The eventual removal command is:

```bash
git add src/render/LegacyForceGraphRenderer.ts src/render/createRenderer.ts tests/perf/phase1.runtime.spec.ts
git commit -m "chore: remove legacy force orbit flag"
```

Do not run that commit in the current environment.

- [ ] **Step 12: Verify repository hygiene and commit the gate implementation**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` has no output. `git status --short` lists the explicit Task 14 files plus the user's existing `?? .serena/`; no `.serena/` path is staged.

Commit only the gate implementation:

```bash
git add package.json playwright.config.ts playwright.perf.config.ts vite.config.ts scripts/perf-server.mjs scripts/check-bundle.mjs scripts/precompress.mjs scripts/run-phase1-d3.mjs scripts/run-phase1-rollback.mjs scripts/verify-phase1-release.mjs src/perf/marks.ts src/perf/testApi.ts src/components/StarMap.tsx src/components/StaticCatalogView.tsx src/components/WordCard.tsx src/render/LegacyForceGraphRenderer.ts tests/perf/fixtures.ts tests/perf/perf.ts tests/perf/environment.ts tests/perf/phase1.cold-start.spec.ts tests/perf/phase1.runtime.spec.ts tests/perf/phase1.persistence.spec.ts tests/perf/phase1.rollback.spec.ts tests/browser/phase1.spec.ts tests/browser/phase1.visual.spec.ts tests/browser/phase1.visual.spec.ts-snapshots/phase1-desktop-darwin.png tests/browser/phase1.visual.spec.ts-snapshots/phase1-mobile-viewport-darwin.png
git commit -m "test: enforce phase one performance gates"
```

## Final Phase 1 Verification

- [ ] `npm run typecheck` exits 0.
- [ ] `npm run test:unit` exits 0.
- [ ] `npm run build` exits 0 with no duplicate-Three warning.
- [ ] `npm ls three --all` resolves only Three 0.184.0.
- [ ] `npm run perf:bundle` enforces 120 KiB initial and 430 KiB all-JS gzip budgets.
- [ ] A score-eligible D1/D2 run enforces the exact shell/first-scene p75 and p95 budgets, the 650 KiB first-scene transfer budget, median FPS >= 50, p95 `presentIntervalMs` <= 33.3 ms, visual feedback p95 <= 100 ms, and the C0_COMPARE 25 percent-or-20 ms improvement rule.
- [ ] Desktop and mobile-viewport functional, visual, canvas-pixel, and lifecycle tests pass.
- [ ] Overview and focused scenes record zero D3 ticks for 10 seconds after layout while local orbit and edge endpoints continue moving.
- [ ] Ten production mount/unmount cycles return renderer-owned geometry, texture, listener, and rAF counts to zero within the specified plateau tolerance.
- [ ] One hundred progress writes use only `star-vocab-progress-v1`, retain the `Record<string, Progress>` payload and existing SRS fields, and expose retry after failure.
- [ ] D1/D2 eligibility is derived from fresh pre/post environment probes; only a score-eligible run may satisfy the numeric release gate, and every ineligible run remains explicitly diagnostic.
- [ ] `npm run perf:phase1:d3` records explicit `skipped: no-adb` evidence when the real-device toolchain is unavailable and never fabricates a pass.
- [ ] The rollback drill resolves the baseline report's immutable source commit/tree and proves that build and the candidate both read `star-vocab-progress-v1` without migration.
- [ ] `.serena/` remains untracked and unstaged.

Phase 2 may begin only after every Phase 1 correctness, build, bundle, browser, visual, lifecycle, score-eligible D1/D2 performance, relative-baseline, persistence, and rollback gate passes and `verify:phase1-release` exits 0. Passing only the local non-scoring diagnostics does not authorize Phase 2. Missing D3 tooling remains visible as `skipped: no-adb`; it is never interpreted as success, and Phase 2 cannot pass its own release gate or authorize Phase 3 until its real Pixel 7a matrix succeeds.
