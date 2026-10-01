# Phase 2 Sharded Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Phase 2 release that starts from a validated manifest, renders a bounded root or sector overview, loads sector and root data on demand with deterministic precomputed layout, and preserves the existing catalog, interactions, and `star-vocab-progress-v1` data.

**Architecture:** Keep Phase 1's `GraphRenderer` methods and renderer-neutral `SceneSnapshot` boundary. Extend the Phase 1 monolith repository into monolith and sharded implementations behind one session-scoped contract; build immutable hash-addressed assets from the existing human-maintained sources; let `SceneCoordinator` alone own repository sessions, request epochs, pins, and visible commits. Build every 3D and DOM scene through one pure LOD projector so the Legacy renderer, `StaticCatalogView`, and later Phase 3 renderer consume identical validated snapshots.

**Tech Stack:** TypeScript 5, React 18, Zustand 4, Three.js and the Phase 1 Legacy ForceGraph adapter, Node.js ESM build scripts, Web Crypto SHA-256, CacheStorage, Vitest with `react-dom/client` and `act`, Playwright, Chrome DevTools Protocol.

---

## Execution Gate

This plan starts only after the complete Phase 1 plan is implemented, committed, and accepted against every Phase 1 release gate, including score-eligible D1/D2 evidence and an exit-0 `npm run verify:phase1-release`. It is not enough for Phase 1 unit tests or local non-scoring diagnostics to pass.

The required Phase 1 contracts are:

- Phase 1 Task 3: `src/graph/graphModel.ts` owns stable keys and O(N+E) graph indexes.
- Phase 1 Task 4: `src/data/CatalogRepository.ts` and `src/data/catalogSchema.ts` load and validate monolith `Catalog`.
- Phase 1 Task 5: `src/store/useStore.ts` owns mutually exclusive `ViewTarget` and atomic navigation actions.
- Phase 1 Task 6: `src/render/contracts.ts` owns `GraphRenderer`, `SceneSnapshot`, `ScenePatch`, `RendererCommand`, metrics, `SceneSidecars`, and `WordOrbit`.
- Phase 1 Task 7: `src/scene/SceneCoordinator.ts` is the only 3D Store subscriber and owns epoch, `AbortController`, renderer, and repository lifetime.
- Phase 1 Task 10: `src/components/StaticCatalogView.tsx` and `src/components/StarMap.tsx` implement `showCanvas`, `showStatic`, `onIntent`, and `fallback-ready` host flow.

At final plan verification on 2026-07-20, `command -v adb` returns no path and `adb devices -l` fails with `command not found`. That remains an explicit Phase 1 `skipped: no-adb` result, not a pre-Task 1 requirement: Phase 2 may start when the scored Phase 1 release verifier passes. A real Pixel 7a D3 run is instead a hard Phase 2 completion gate in Task 11; Phase 3 must not start until that run passes.

- [ ] **Gate 1: Verify the Phase 1 branch is clean except for explicitly ignored user state**

Run:

```bash
git status --short --branch
```

Expected: the Phase 1 branch is shown; no tracked file is modified. An existing untracked `.serena/` directory may remain and must never be staged.

- [ ] **Gate 2: Re-run the complete Phase 1 automated matrix**

Run:

```bash
npm ci
npm run data
npm run build
npm run perf:bundle
npm run test:unit
npm run build:benchmark
npm run perf:precompress
npm run test:browser -- tests/browser/phase1.spec.ts tests/browser/phase1.visual.spec.ts --project=desktop
npm run test:browser -- tests/browser/phase1.spec.ts tests/browser/phase1.visual.spec.ts --project=mobile-viewport
npm run perf:phase1 -- --project=D1 --project=D2
npm run perf:phase1:rollback
npm run verify:phase1-release
npm ls three
```

Expected: every command exits 0 and `npm ls three` reports one Three.js runtime version. `perf:phase1` runs the three files Phase 1 actually defines: `tests/perf/phase1.cold-start.spec.ts`, `tests/perf/phase1.runtime.spec.ts`, and `tests/perf/phase1.persistence.spec.ts`; the rollback script and scored release verifier must also pass. A missing or non-score-eligible Phase 1 report stops Phase 2 here. Missing adb/D3 remains recorded but does not block Task 1, because the real-device hard gate belongs to Phase 2 completion.

- [ ] **Gate 3: Confirm Phase 1's public renderer contract already reserves Phase 2 sidecars**

Inspect `src/render/contracts.ts` and verify it contains these exact concepts before Phase 2 code is written:

```ts
export interface WordOrbit {
  radius: number
  phase: number
  inclination: number
  ascendingNode: number
  angularVelocity: number
}

export interface SceneSidecars {
  portals: Readonly<Record<string, PortalSidecar>>
  wordCards: Readonly<Record<`word:${string}`, WordCardSnapshot>>
}
```

Expected: Phase 1 word nodes use `orbit: null`, Phase 1 portal records are an empty frozen object, and Phase 1 word-card sidecars are built from validated monolith data. If those fields are absent, finish Phase 1 Task 6 and its tests before continuing.

## Target File Map

Build ownership:

- `scripts/build-dataset.mjs`: orchestration only; preserve color/phonetic enrichment and monolith `wordlinks.json`, then invoke the v2 compiler.
- `scripts/data/canonical-json.mjs`: canonical object ordering, UTF-8 bytes, SHA-256, and reproducible gzip measurements.
- `scripts/data/compile-relations.mjs`: current manual and inferred relation semantics, canonical relation IDs, and root/sector aggregation inputs.
- `scripts/data/layout-v2.mjs`: lock validation and the three explicit mutation modes.
- `scripts/build-layout.mjs`: CLI wrapper for `--add-missing`, `--prune`, and `--reflow`.
- `scripts/data/compile-v2.mjs`: word index, sector indexes, root shards, manifest, limits, and assets-first local publication.
- `scripts/layout-lock.v2.json`: committed human-reviewed layout input.
- `public/data/v2/`: generated current manifest and immutable hash-addressed assets; never edit by hand.

Runtime ownership:

- `src/data/CatalogRepository.ts`: repository interface, immutable `CatalogSession`, factory, and diagnostics types.
- `src/data/MonolithCatalogRepository.ts`: Phase 1 implementation moved without semantic changes.
- `src/data/ShardedCatalogRepository.ts`: manifest/session orchestration, verified lazy assets, and session isolation.
- `src/data/verifiedAssetLoader.ts`: status/bytes/hash/UTF-8/JSON/schema verification and retry classification.
- `src/data/SharedRequestPool.ts`: coalesced request consumers and transport abort reference counting.
- `src/data/ShardLru.ts`: parsed root shard LRU with count, raw-byte, pin, and fingerprint rules.
- `src/data/ManifestStore.ts`: CacheStorage `last-known-good` manifest only.
- `src/scene/projectCatalogScene.ts`: pure overview/sector/root/word LOD and portal projection.
- `src/scene/catalogUiSnapshot.ts`: immutable UI and static snapshots from the same projected data.
- `src/scene/SceneCoordinator.ts`: staged intents, epoch, repository session, readiness gate, pin transitions, and atomic visible commit.
- `src/store/useStore.ts`: committed target plus navigation requests; no repository, Three, or shard objects.
- `src/components/StaticCatalogView.tsx`: DOM rendering and `fallback-ready`; no Store or repository imports.
- `src/components/VirtualCatalogList.tsx`: bounded DOM rows for 2K roots and 10K word-index entries.

Test ownership follows the Phase 1 test infrastructure:

- `tests/unit/`: pure schemas, builders, layout, LRU, Store, and projection.
- `tests/integration/`: repository and Coordinator with controlled real `Response` bytes.
- `tests/browser/`: loading order, navigation, fallback, and fault injection.
- `tests/perf/`: Phase 2 request, frame, interaction, LOD, and heap gates.
- `tests/fixtures/catalogFactory.ts`: the only catalog/scene fixture API; generated artifacts may only be materialized under `test-results/generated/`.

### Task 1: Define the Shared Catalog v2 Contract

**Depends on:** Phase 1 Tasks 3, 4, and 6.

**Files:**

- Create: `src/data/catalogV2Schema.mjs`
- Create: `src/data/catalogV2Schema.d.ts`
- Modify: `src/data/catalogSchema.ts`
- Create: `tests/unit/catalogV2Schema.test.ts`
- Create: `tests/helpers/catalogV2Fixtures.ts`

- [ ] **Step 1: Write RED tests for the valid asset shapes and cross-reference rules**

Add tests that import the real parser functions and cover one valid manifest, word index, sector index, and root shard. Include this collision assertion because current source data contains raw ID `scope` in both namespaces:

```ts
import { describe, expect, it } from 'vitest'
import {
  parseCatalogManifestV2,
  parseRootShardV2,
  parseSectorIndexV2,
  parseWordIndexV2,
} from '../../src/data/catalogV2Schema.mjs'
import { rootKey, wordKey } from '../../src/graph/graphModel'
import { validManifest, rootShardWithNoLocalCrossEndpoint } from '../helpers/catalogV2Fixtures'

describe('catalog v2 schema', () => {
  it('keeps colliding raw root and word ids distinct', () => {
    expect(rootKey('scope')).toBe('root:scope')
    expect(wordKey('scope')).toBe('word:scope')
    expect(rootKey('scope')).not.toBe(wordKey('scope'))
  })

  it('rejects an asset URL that can escape the v2 directory', () => {
    expect(() => parseCatalogManifestV2(validManifest({
      wordIndex: {
        url: '../words.json',
        sha256: 'a'.repeat(64),
        bytes: 10,
        gzipBytes: 8,
      },
    }))).toThrow(/asset url/i)
  })

  it('rejects a cross projection unless exactly one endpoint belongs to the shard root', () => {
    expect(() => parseRootShardV2(
      rootShardWithNoLocalCrossEndpoint(),
      validManifest(),
      'spect',
    )).toThrow(/cross relation endpoint/i)
  })
})
```

The same file must have separately named tests for duplicate root, sector, word, and relation IDs; invalid SHA-256 length; non-positive byte counts; `gzipBytes > bytes`; unknown root/sector references; invalid relation types; a local relation with an endpoint outside its shard; a cross relation whose remote root is absent from the manifest; and non-finite layout numbers.

- [ ] **Step 2: Run the schema test and verify the intended RED failure**

Run:

```bash
npx vitest run tests/unit/catalogV2Schema.test.ts
```

Expected: FAIL because `catalogV2Schema.mjs` does not exist. The failure must not be a malformed fixture or unresolved Phase 1 import.

- [ ] **Step 3: Add the complete public declarations**

Define these exact public shapes in `src/data/catalogV2Schema.d.ts`. Root shard and sector assets deliberately omit global `catalogVersion`; the active manifest's exact AssetRef binds their bytes to a session, so an unrelated catalog change does not invalidate every shard.

```ts
import type { RelType, Root, Word } from '../types'
import type { WordOrbit } from '../render/contracts'

export type Vec3 = readonly [number, number, number]
export type Sha256Hex = string

export interface AssetRef {
  url: string
  sha256: Sha256Hex
  bytes: number
  gzipBytes: number
}

export interface CanonicalRelation {
  id: string
  a: string
  b: string
  type: RelType
  note: string
}

export interface RelationEndpoint {
  wordId: string
  word: string
  rootId: string
}

export interface CrossRelationProjection {
  id: string
  type: RelType
  note: string
  endpoints: readonly [RelationEndpoint, RelationEndpoint]
}

export interface AggregateRelation {
  id: string
  sourceId: string
  targetId: string
  count: number
  typeCounts: Readonly<Partial<Record<RelType, number>>>
}

export interface RootOverview extends Root {
  position: Vec3
  sectorId: string
  wordCount: number
  shard: AssetRef
}

export interface SectorOverview {
  id: string
  position: Vec3
  rootCount: number
  index: AssetRef
}

export interface CatalogManifestV2 {
  schemaVersion: 2
  catalogVersion: string
  layoutVersion: string
  counts: Readonly<{
    roots: number
    words: number
    relations: number
    crossRelations: number
  }>
  roots: readonly RootOverview[]
  sectors: readonly SectorOverview[]
  sectorRelations: readonly AggregateRelation[]
  rootRelations: readonly AggregateRelation[]
  wordIndex: AssetRef
}

export interface WordIndexEntry {
  id: string
  word: string
  rootId: string
  def_zh: string
  order: number
  contentHash: Sha256Hex
}

export interface WordIndexV2 {
  schemaVersion: 2
  entries: readonly WordIndexEntry[]
}

export interface SectorPortalSummary {
  sectorId: string
  relationCount: number
}

export interface SectorIndexV2 {
  schemaVersion: 2
  sectorId: string
  rootRelations: readonly AggregateRelation[]
  portals: readonly SectorPortalSummary[]
}

export interface ShardWord extends Word {
  orbit: WordOrbit
}

export interface RootShardContentV2 {
  schemaVersion: 2
  rootId: string
  words: readonly Word[]
  localRelations: readonly CanonicalRelation[]
  crossRelations: readonly CrossRelationProjection[]
}

export interface RootShardLayoutV2 {
  orbits: Readonly<Record<string, WordOrbit>>
}

export interface RootShardV2 {
  schemaVersion: 2
  rootId: string
  words: readonly ShardWord[]
  localRelations: readonly CanonicalRelation[]
  crossRelations: readonly CrossRelationProjection[]
}

export function parseCatalogManifestV2(value: unknown): Readonly<CatalogManifestV2>
export function parseWordIndexV2(value: unknown, manifest: CatalogManifestV2): Readonly<WordIndexV2>
export function parseSectorIndexV2(value: unknown, manifest: CatalogManifestV2, sectorId: string): Readonly<SectorIndexV2>
export function parseRootShardContentV2(value: unknown, manifest: CatalogManifestV2, rootId: string): Readonly<RootShardContentV2>
export function parseRootShardLayoutV2(value: unknown, content: RootShardContentV2): Readonly<RootShardLayoutV2>
export function assembleRootShardV2(content: RootShardContentV2, layout: RootShardLayoutV2): Readonly<RootShardV2>
export function parseRootShardV2(value: unknown, manifest: CatalogManifestV2, rootId: string): Readonly<RootShardV2>
```

- [ ] **Step 4: Implement shared runtime validators with classified layout errors**

Implement `tests/helpers/catalogV2Fixtures.ts` with `validManifest(overrides?: Partial<CatalogManifestV2>)`, `validWordIndex()`, `validSectorIndex()`, `validRootShard()`, and `rootShardWithNoLocalCrossEndpoint()`. Use concrete `spect`, `inspect`, `port`, and `import` records with all required Root and Word fields, valid 64-character hashes, sector `sector-0001`, and finite layout values. The invalid cross helper changes only the two endpoint root IDs so neither endpoint belongs to shard root `spect`.

Implement `catalogV2Schema.mjs` as dependency-free ESM so Node build scripts and the browser import the same validation logic. Enforce all fields from Step 1. Export `CatalogContentError` and `CatalogLayoutError`; only finite-position/orbit failures use `CatalogLayoutError`. Deep-freeze every accepted object and array before returning it.

Asset URLs must satisfy all of these checks:

```js
export function assertRelativeAssetUrl(url) {
  if (typeof url !== 'string' || url.length === 0) throw new CatalogContentError('invalid asset url')
  if (url.startsWith('/') || url.includes('\\') || url.includes('?') || url.includes('#')) {
    throw new CatalogContentError('invalid asset url')
  }
  const parts = url.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new CatalogContentError('invalid asset url')
  }
  return url
}
```

`parseCatalogManifestV2` must validate uniqueness and all internal membership before returning. Root-shard parsing is explicitly two-stage: `parseRootShardContentV2` validates and deep-freezes every non-layout field and reference without retaining an unvalidated orbit; only then may `parseRootShardLayoutV2` validate the orbit map. `parseRootShardV2` is a strict convenience wrapper that calls both stages and assembles the result. On `CatalogLayoutError`, callers may pass the already validated frozen content to the deterministic fallback and then `assembleRootShardV2`; they must never recover by reading content fields from the original raw JSON.

- [ ] **Step 5: Run focused and full GREEN verification**

Run:

```bash
npx vitest run tests/unit/catalogV2Schema.test.ts
npm run test:unit
npm run build
```

Expected: all commands PASS with no schema warnings or TypeScript errors.

- [ ] **Step 6: Commit the schema slice**

Run:

```bash
git add src/data/catalogV2Schema.mjs src/data/catalogV2Schema.d.ts src/data/catalogSchema.ts tests/unit/catalogV2Schema.test.ts tests/helpers/catalogV2Fixtures.ts
git diff --cached --check
git commit -m "feat: define versioned catalog contracts"
```

Expected: one commit containing only the shared schema and its tests; `.serena/` is not staged.

### Task 2: Extract a Deterministic Canonical Relation Compiler

**Depends on:** Task 1 and Phase 1 Task 3 stable key helpers.

**Files:**

- Create: `scripts/data/compile-relations.mjs`
- Create: `scripts/data/canonical-json.mjs`
- Modify: `scripts/build-dataset.mjs`
- Create: `tests/unit/dataBuild.test.ts`
- Modify: `tests/fixtures/catalogFactory.ts`

- [ ] **Step 1: Write RED regression tests around the current human sources**

Test the pure relation compiler against `public/data/roots.json`, `public/data/words.json`, and `scripts/manual-links.json`. Normalize the checked-in `public/data/wordlinks.json` to the same endpoint ordering and assert exact semantic equality.

```ts
it('preserves the current 251 canonical relations', async () => {
  const source = await loadC0Fixture()
  const result = compileRelations(source.roots, source.words, source.manualLinks)
  expect(result.relations).toHaveLength(251)
  expect(result.relations.filter((relation) => relation.aRootId !== relation.bRootId)).toHaveLength(55)
  expect(normalizeWordLinks(result.relations)).toEqual(normalizeWordLinks(source.wordLinks))
})

it('assigns a stable typed relation key', () => {
  expect(relationKey('antonym', 'word:export', 'word:import'))
    .toBe('rel:antonym:word:export:word:import')
})
```

Also assert that source array order changes do not alter canonical relation byte order, an endpoint pair cannot occur twice, all endpoint words exist, and both endpoints carry root IDs in the compiled representation.

Add this shared helper to `tests/fixtures/catalogFactory.ts` and import it in the test:

```ts
export function normalizeWordLinks(links: readonly WordLink[]): readonly WordLink[] {
  return links
    .map((link) => {
      const [a, b] = [link.a, link.b].sort()
      return { a, b, type: link.type, note: link.note }
    })
    .sort((left, right) =>
      `${left.type}:${left.a}:${left.b}`.localeCompare(`${right.type}:${right.a}:${right.b}`),
    )
}
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/unit/dataBuild.test.ts -t "canonical relations"
```

Expected: FAIL because `scripts/data/compile-relations.mjs` does not exist.

- [ ] **Step 3: Implement canonical JSON and relation keys**

Implement `canonical-json.mjs` with recursively sorted object keys, preserved array order, two-space indentation, one trailing newline, SHA-256 over those exact UTF-8 bytes, and reproducible gzip size using level 9 and mtime 0.

```js
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

export function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalize(value), null, 2)}\n`, 'utf8')
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function gzipByteLength(bytes) {
  return gzipSync(bytes, { level: 9, mtime: 0 }).byteLength
}
```

Implement `compile-relations.mjs` by moving the existing suffix, antonym-prefix, and classic-prefix-family inference without changing its semantics. Sort endpoint keys before creating this exact ID:

```js
export function relationKey(type, aWordKey, bWordKey) {
  const [a, b] = [aWordKey, bWordKey].sort()
  return `rel:${type}:${a}:${b}`
}
```

Return canonical relations sorted by relation ID. Each compiled relation must retain `a`, `b`, `aRootId`, `bRootId`, `type`, and `note` so later aggregation never rescans or guesses ownership.

- [ ] **Step 4: Reduce `build-dataset.mjs` to orchestration without changing monolith output**

Keep the existing validation, palette backfill, optional phonetic enrichment, and `public/data/wordlinks.json` write. Replace only the inline relation inference with `compileRelations()`. In `--fetch` mode, complete phonetic enrichment before later v2 compilation so root shards contain the updated source bytes.

- [ ] **Step 5: Verify GREEN and prove the compatibility output did not change**

Run:

```bash
npx vitest run tests/unit/dataBuild.test.ts
npm run data
git diff --exit-code -- public/data/roots.json public/data/words.json public/data/wordlinks.json scripts/manual-links.json
```

Expected: tests PASS, `npm run data` reports 72 roots, 432 words, and 251 links, and the final command exits 0.

- [ ] **Step 6: Commit the relation compiler slice**

Run:

```bash
git add scripts/build-dataset.mjs scripts/data/compile-relations.mjs scripts/data/canonical-json.mjs tests/unit/dataBuild.test.ts tests/fixtures/catalogFactory.ts
git diff --cached --check
git commit -m "refactor: extract deterministic relation compiler"
```

Expected: only the compiler refactor and regression tests are committed.

### Task 3: Add the Committed Layout Lock and Explicit Mutation CLI

**Depends on:** Task 2.

**Files:**

- Create: `scripts/data/layout-v2.mjs`
- Create: `scripts/build-layout.mjs`
- Create: `scripts/layout-lock.v2.json`
- Modify: `package.json`
- Create: `tests/unit/layoutLock.test.ts`
- Create: `tests/helpers/layoutFixtures.ts`

- [ ] **Step 1: Write RED tests for read-only validation and all three mutation modes**

Use temporary directories supplied by Vitest; never point a unit test at the checked-in lock. Cover these exact cases:

```ts
it('rejects missing and orphan layout entries in read-only mode', () => {
  const { lock, source } = layoutFixture()
  const missing = structuredClone(lock)
  delete missing.words.inspect
  const orphan = structuredClone(lock)
  orphan.roots.orphan = [1, 2, 3]
  expect(() => validateLayoutLock(missing, source)).toThrow(/missing word/i)
  expect(() => validateLayoutLock(orphan, source)).toThrow(/orphan root/i)
})

it('add-missing preserves every existing byte-level coordinate and membership', () => {
  const { lock, source } = layoutFixture()
  const next = updateLayoutLock(lock, sourceWithNewRoot(source, 'newroot'), 'add-missing')
  expect(next.roots.spect).toEqual(lock.roots.spect)
  expect(next.words.inspect).toEqual(lock.words.inspect)
  expect(next.sectors['sector-0001'].position).toEqual(lock.sectors['sector-0001'].position)
  expect(next.sectors['sector-0001'].rootIds).toContain('newroot')
})

it('prune removes only deleted ids and empty sectors', () => {
  const { lock, source } = layoutFixture()
  const next = updateLayoutLock(lock, sourceWithoutRoot(source, 'port'), 'prune')
  expect(next.roots.port).toBeUndefined()
  expect(next.words.import).toBeUndefined()
  expect(next.roots.spect).toEqual(lock.roots.spect)
  expect(next.words.inspect).toEqual(lock.words.inspect)
})
```

Implement `tests/helpers/layoutFixtures.ts` with concrete `spect/inspect` and `port/import` Root and Word records, a valid two-root lock, and these exports: `layoutFixture()`, `sourceWithNewRoot(source, rootId)`, and `sourceWithoutRoot(source, rootId)`. `sourceWithNewRoot` adds one complete root plus one complete word; `sourceWithoutRoot` removes the root and all of its words.

Add separate tests for `--reflow` byte determinism, 200-root sector capacity, finite positions, positive orbit radius, fixed precision, algorithm mismatch, and a ROOT2K fixture producing no more than 64 sectors.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/unit/layoutLock.test.ts
```

Expected: FAIL because `layout-v2.mjs` does not exist.

- [ ] **Step 3: Implement deterministic layout constants and lock hashing**

Use these exact version constants and quantization rule:

```js
export const LAYOUT_SCHEMA_VERSION = 2
export const LAYOUT_ALGORITHM_VERSION = 'galaxy-layout-2'
export const LAYOUT_SEED = 'star-vocab-layout-v2'
export const SECTOR_CAPACITY = 200
export const QUANTIZATION = 1_000_000

export function quantize(value) {
  const result = Math.round(value * QUANTIZATION) / QUANTIZATION
  return Object.is(result, -0) ? 0 : result
}
```

For `reflow`, sort root IDs, split them into 200-root sectors named `sector-0001`, `sector-0002`, and so on, place sector centers on a fixed-seed Fibonacci sphere, and place roots around their sector center using stable hash-derived golden-angle offsets. Derive each word orbit from `LAYOUT_SEED`, root ID, and word ID, with finite positive radius and angular velocity. Quantize before insertion into the lock.

For `add-missing`, process new root and word IDs in ascending order, place roots in the lowest-ID sector with remaining capacity, create the next numbered sector only when all existing sectors are full, and never recalculate an existing value. For `prune`, remove only absent IDs and sectors that become empty. Ordinary validation performs no writes.

Compute `layoutVersion` as SHA-256 of `canonicalBytes(lock)`; do not add a timestamp or machine field.

- [ ] **Step 4: Implement the CLI and package script**

Add this script entry:

```json
{
  "scripts": {
    "data:layout": "node scripts/build-layout.mjs"
  }
}
```

`build-layout.mjs` must accept exactly one of `--add-missing`, `--prune`, or `--reflow`; reject zero or multiple modes with exit code 1; write through a sibling temporary file and rename it over `scripts/layout-lock.v2.json` only after re-validation.

- [ ] **Step 5: Run GREEN tests and create the initial reviewed lock**

Run:

```bash
npx vitest run tests/unit/layoutLock.test.ts
npm run data:layout -- --reflow
cp scripts/layout-lock.v2.json /tmp/star-vocab-layout-lock.v2.json
npm run data:layout -- --reflow
cmp scripts/layout-lock.v2.json /tmp/star-vocab-layout-lock.v2.json
```

Expected: tests PASS, both reflow runs are byte-identical, and the checked-in candidate lock contains exactly 72 roots and 432 words.

- [ ] **Step 6: Commit the layout slice**

Run:

```bash
git add package.json package-lock.json scripts/build-layout.mjs scripts/data/layout-v2.mjs scripts/layout-lock.v2.json tests/unit/layoutLock.test.ts tests/helpers/layoutFixtures.ts
git diff --cached --check
git commit -m "feat: lock deterministic catalog layout"
```

Expected: the commit contains the CLI, lock implementation, tests, and initial lock; no generated v2 runtime assets yet.

### Task 4: Compile Deterministic Manifest, Sector Indexes, and Root Shards

**Depends on:** Tasks 1 through 3.

**Files:**

- Create: `scripts/data/compile-v2.mjs`
- Modify: `scripts/build-dataset.mjs`
- Modify: `package.json`
- Modify: `scripts/README.md`
- Create: `public/data/v2/manifest.json`
- Create: `public/data/v2/word-index.<sha256>.json`
- Create: `public/data/v2/sectors/<sector-id>.<sha256>.json`
- Create: `public/data/v2/roots/<root-id>.<sha256>.json`
- Modify: `tests/unit/dataBuild.test.ts`
- Modify: `tests/fixtures/catalogFactory.ts`

- [ ] **Step 1: Write RED tests for deterministic assets and current-data compatibility**

Add tests that compile into an in-memory `Map<string, Buffer>` and assert:

```ts
it('compiles C0 without losing a field or relation', async () => {
  const source = await loadC0Fixture()
  const output = compileCatalogV2(source, source.layoutLock)
  const rebuilt = reconstructCatalog(output)

  expect(rebuilt.roots).toEqual(source.roots)
  expect(rebuilt.words).toEqual(source.words)
  expect(rebuilt.wordLinks).toEqual(normalizeWordLinks(source.wordLinks))
  expect(output.manifest.counts).toEqual({
    roots: 72,
    words: 432,
    relations: 251,
    crossRelations: 55,
  })
})

it('uses only manifest-relative immutable asset URLs', async () => {
  const source = await loadC0Fixture()
  const output = compileCatalogV2(source, source.layoutLock)
  const refs = [
    output.manifest.wordIndex,
    ...output.manifest.sectors.map((sector) => sector.index),
    ...output.manifest.roots.map((root) => root.shard),
  ]
  expect(refs.every((ref) =>
    !ref.url.startsWith('/') && /^(word-index\.|sectors\/|roots\/)/.test(ref.url),
  )).toBe(true)
  expect(refs.every((ref) => ref.url.includes(ref.sha256))).toBe(true)
})
```

Add separate tests for raw UTF-8 byte length, SHA-256, gzip byte length, byte-identical repeated compilation, manifest root/sector counts, root overview fields, word-index stable order, full word fields in shards, orbit equality with the lock, one local relation, two byte-identical cross projections, aggregate counts, and manifest written last.

- [ ] **Step 2: Write RED tests for limits and dependency-graph invalidation**

Use `createCatalogFixture()` to assert all five shard limits independently. Compare the logical current AssetRef map before and after mutations:

- Changing only one word's `example` changes manifest, word index, and that root shard.
- Adding one manual cross-root relation changes manifest, both endpoint root shards, and one or two endpoint sector indexes, but not word index.
- Adding a prefix-family word that creates an inferred remote relation changes word index, its own shard, the remote endpoint shard, and affected sector indexes.
- No unrelated current AssetRef changes in any of those cases.
- 301 words, 1,201 local-plus-cross records, degree 129, raw bytes over 1 MiB, or gzip bytes over 64 KiB each fail the build with a distinct message.

- [ ] **Step 3: Verify RED**

Run:

```bash
npx vitest run tests/unit/dataBuild.test.ts
```

Expected: FAIL because `compileCatalogV2` and v2 fixture support do not exist.

- [ ] **Step 4: Implement exact asset construction**

Build `catalogVersion` from canonical full roots, words, and canonical relations. Build `layoutVersion` from canonical lock bytes. Do not embed `catalogVersion` in individual shard/index payloads.

The word index must use this shape so any full word-field change invalidates its content without copying examples into the lightweight index:

```js
const wordIndex = {
  schemaVersion: 2,
  entries: words.map((word, order) => ({
    id: word.id,
    word: word.word,
    rootId: word.rootId,
    def_zh: word.def_zh,
    order,
    contentHash: sha256Hex(canonicalBytes(word)),
  })),
}
```

For each root shard, copy complete Word fields and attach its locked orbit. Store a same-root canonical relation only in that root's `localRelations`. Store each cross-root `CrossRelationProjection` in both endpoint shards with identical `id`, `type`, `note`, and sorted endpoint tuple.

Build the full canonical relation graph before deriving root and sector aggregates. Sort aggregate candidates by relation count descending, then stable source ID, then stable target ID. Keep all canonical data in shards even when manifest or scene LOD trims overview edges.

- [ ] **Step 5: Implement hash-addressed paths and assets-first local publication**

Use full 64-character SHA-256 filenames. Resolve these URLs relative to `public/data/v2/manifest.json`:

```js
function assetRef(relativeDirectory, stableId, value) {
  const bytes = canonicalBytes(value)
  const sha256 = sha256Hex(bytes)
  const encodedId = encodeURIComponent(stableId)
  return {
    ref: {
      url: `${relativeDirectory}/${encodedId}.${sha256}.json`,
      sha256,
      bytes: bytes.byteLength,
      gzipBytes: gzipByteLength(bytes),
    },
    bytes,
  }
}
```

Word index uses `word-index.<sha256>.json`. Write all hash assets to a sibling staging directory, parse and re-verify them, rename each immutable asset into `public/data/v2/`, then write and rename `manifest.json` last. Do not delete older hash files. `--check` compiles in memory, compares the current manifest and every referenced asset, performs no writes, and ignores unreferenced retained hashes.

- [ ] **Step 6: Wire the compiler after existing source enrichment**

Add these scripts while retaining `data` and `data:enrich` names:

```json
{
  "scripts": {
    "data": "node scripts/build-dataset.mjs",
    "data:check": "node scripts/build-dataset.mjs --check",
    "data:enrich": "node scripts/build-dataset.mjs --fetch"
  }
}
```

The orchestration order must be: load human sources, validate, fill colors, optionally enrich phonetics, compile canonical relations, write compatibility `wordlinks.json`, validate the layout lock read-only, compile v2 assets, and publish manifest last. `--check` must reject any source/lock/output drift.

- [ ] **Step 7: Extend the shared deterministic fixture factory**

In `tests/fixtures/catalogFactory.ts`, keep these exact public names:

```ts
export type CatalogFixtureName = 'C2' | 'CAT5K' | 'CAT10K' | 'ROOT2K' | 'LOD_MAX'
export type SceneFixtureName = 'C0_COMPARE' | 'LOD_COMPARE' | 'GPU10K' | 'GPU25K'

export interface FixtureExpected {
  rootCount: number
  wordCount: number
  relationCount: number
  maxDegree: number
  density: number
}

export interface CatalogFixture {
  roots: readonly Root[]
  words: readonly Word[]
  manualLinks: readonly WordLink[]
  wordLinks: readonly WordLink[]
  layoutLock: Readonly<LayoutLockV2>
  expected: Readonly<FixtureExpected>
  fingerprint: string
}

export interface SceneFixture {
  data: Readonly<SceneSnapshot>
  expected: Readonly<FixtureExpected>
  fingerprint: string
}

export function loadC0Fixture(): Promise<CatalogFixture>
export function createCatalogFixture(name: CatalogFixtureName, seed?: string): CatalogFixture
export function createSceneFixture(name: SceneFixtureName, seed?: string): SceneFixture
export function materializeFixture(fixture: CatalogFixture, outDir: string): Promise<void>
export function normalizeWordLinks(links: readonly WordLink[]): readonly WordLink[]
export function reconstructCatalog(output: CompiledCatalogV2): Readonly<{
  roots: readonly Root[]
  words: readonly Word[]
  wordLinks: readonly WordLink[]
}>
```

Reject `materializeFixture()` unless `outDir` resolves below `test-results/generated/`. CAT5K has 300 roots, CAT10K has 600 roots, ROOT2K has 2,000 roots and 10,000 words, and LOD_MAX has two 300-word/1,200-record shards plus the required 1,200-remote-root portal case.

- [ ] **Step 8: Verify GREEN, generated files, and deterministic rebuild**

Run:

```bash
npx vitest run tests/unit/dataBuild.test.ts
npm run data
npm run data:check
cp public/data/v2/manifest.json /tmp/star-vocab-manifest-v2.json
npm run data
cmp public/data/v2/manifest.json /tmp/star-vocab-manifest-v2.json
git diff --check
```

Expected: every command exits 0; current catalog reconstructs to exactly 72 roots, 432 words, and 251 relations; the second build is byte-identical.

- [ ] **Step 9: Commit the generated-data slice**

Run:

```bash
git add package.json package-lock.json scripts/build-dataset.mjs scripts/README.md scripts/data/compile-v2.mjs tests/unit/dataBuild.test.ts tests/fixtures/catalogFactory.ts public/data/v2
git diff --cached --check
git commit -m "feat: generate versioned catalog shards"
```

Expected: generated current v2 assets are committed with the compiler and tests. Existing human sources remain unchanged unless the reviewed enrichment command intentionally changed them.

### Task 5: Verify, Retry, and Coalesce Network Assets

**Depends on:** Tasks 1 and 4.

**Files:**

- Create: `src/data/verifiedAssetLoader.ts`
- Create: `src/data/SharedRequestPool.ts`
- Create: `src/data/ManifestStore.ts`
- Create: `tests/unit/verifiedAssetLoader.test.ts`
- Create: `tests/unit/SharedRequestPool.test.ts`
- Create: `tests/unit/ManifestStore.test.ts`
- Create: `tests/helpers/catalogResponses.ts`

- [ ] **Step 1: Write RED tests for exact byte and hash verification**

Build real `Response` instances from fixture UTF-8 bytes. Inject only transport and timing dependencies; exercise the production decoder, digest, and parser.

```ts
it('verifies raw decoded response bytes before parsing JSON', async () => {
  const bytes = new TextEncoder().encode('{"schemaVersion":2,"entries":[]}\n')
  const ref = await assetRefFor(bytes)
  const result = await loadVerifiedJson({
    manifestUrl: 'https://example.test/app/data/v2/manifest.json',
    ref: { ...ref, url: `word-index.${ref.sha256}.json` },
    signal: new AbortController().signal,
    parse: (value) => value,
    fetchImpl: async () => new Response(bytes, { status: 200 }),
    sleep: async () => undefined,
  })

  expect(result.rawSha256).toBe(ref.sha256)
  expect(result.bytes).toBe(bytes.byteLength)
})

it('rejects a same-length payload with the wrong hash', async () => {
  const good = new TextEncoder().encode('{"a":1}\n')
  const bad = new TextEncoder().encode('{"a":2}\n')
  const ref = await assetRefFor(good)
  await expect(loadVerifiedJson({
    manifestUrl: 'https://example.test/app/data/v2/manifest.json',
    ref: { ...ref, url: `word-index.${ref.sha256}.json` },
    signal: new AbortController().signal,
    parse: (value) => value,
    fetchImpl: async () => new Response(bad, { status: 200 }),
    sleep: async () => undefined,
  })).rejects.toThrow(/sha-256/i)
})
```

Add separately named tests for wrong bytes, invalid fatal UTF-8, invalid JSON, schema failure, cross-origin URL, URL escaping the manifest directory, and a successful relative URL under a GitHub Pages-style `/star-vocab/data/v2/manifest.json` base.

- [ ] **Step 2: Write RED tests for retry classes and shared cancellation**

Assert these exact attempt counts:

- 408, 429, each 5xx response, network timeout, and non-abort network failure: three total attempts.
- 404: one attempt from the loader, surfaced as `AssetNotFoundError`; manifest refresh belongs to the repository.
- bytes, hash, UTF-8, JSON, or schema failure: one normal attempt and one `cache: 'reload'` attempt.
- consumer `AbortError`: no retry and no error logging.

Test request sharing with controlled promises:

```ts
it('keeps shared transport alive while one consumer remains', async () => {
  const pool = new SharedRequestPool<string, string>()
  const transport = deferred<string>()
  const first = new AbortController()
  const second = new AbortController()
  let transportAborted = false

  const start = (signal: AbortSignal) => {
    signal.addEventListener('abort', () => { transportAborted = true })
    return transport.promise
  }
  const a = pool.acquire('root:spect', first.signal, start)
  const b = pool.acquire('root:spect', second.signal, start)

  first.abort()
  await expect(a).rejects.toMatchObject({ name: 'AbortError' })
  expect(transportAborted).toBe(false)
  transport.resolve('spect')
  await expect(b).resolves.toBe('spect')
})
```

Add a second test proving that aborting the final consumer aborts the transport and settles every promise without `unhandledrejection`.

Implement these exact reusable helpers in `tests/helpers/catalogResponses.ts`:

```ts
export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export async function assetRefFor(bytes: Uint8Array): Promise<AssetRef> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return { url: `asset.${sha256}.json`, sha256, bytes: bytes.byteLength, gzipBytes: bytes.byteLength }
}
```

The gzip value is immaterial in transport unit tests; build tests separately verify real gzip measurements.

- [ ] **Step 3: Verify RED**

Run:

```bash
npx vitest run tests/unit/verifiedAssetLoader.test.ts tests/unit/SharedRequestPool.test.ts tests/unit/ManifestStore.test.ts
```

Expected: FAIL because the three production modules do not exist.

- [ ] **Step 4: Implement verified relative-asset loading**

Use this public API:

```ts
export interface VerifiedAsset<T> {
  value: Readonly<T>
  rawSha256: string
  bytes: number
}

export interface VerifiedAssetOptions<T> {
  manifestUrl: string
  ref: AssetRef
  signal: AbortSignal
  parse: (value: unknown) => Readonly<T>
  fetchImpl?: typeof fetch
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export function loadVerifiedJson<T>(options: VerifiedAssetOptions<T>): Promise<VerifiedAsset<T>>
```

Resolve with `new URL(ref.url, manifestUrl)`, then require equal origin and a pathname beginning with the manifest directory pathname. Read `response.arrayBuffer()`, compare `byteLength`, compute browser SHA-256 with `crypto.subtle.digest`, decode with `new TextDecoder('utf-8', { fatal: true })`, parse JSON, and finally run the shared schema parser.

Implement retry as a finite loop. Backoff delays are 100 ms then 250 ms through the injected `sleep`; abort-aware sleep must reject immediately. A cache-integrity retry uses `cache: 'reload'`; immutable success uses the browser's normal HTTP cache. Never use `gzipBytes` as the decoded fetch byte expectation.

- [ ] **Step 5: Implement consumer-counted request pooling**

Use one internal `AbortController` per key and a `Set` of consumer tokens. `acquire()` races the shared transport against the consumer signal. On consumer completion or abort, remove only that token. Abort the transport only when its promise is unsettled and the consumer set becomes empty. Remove a settled entry from the in-flight map so later explicit retries can start a fresh request.

- [ ] **Step 6: Implement the manifest last-known-good store**

Use cache name `star-vocab-catalog-v2` and a synthetic same-origin request ending in `/data/v2/.last-known-good/manifest.json`. The store API is:

```ts
export interface ManifestStore {
  read(): Promise<Readonly<CatalogManifestV2> | null>
  write(manifest: Readonly<CatalogManifestV2>): Promise<void>
  clear(): Promise<void>
}
```

Store only the validated manifest JSON. Do not fetch or store word index, sector indexes, or root shards as a side effect. When CacheStorage is unavailable, `read()` returns null and `write()` is a no-op that reports availability through diagnostics rather than failing catalog rendering.

- [ ] **Step 7: Run focused and full GREEN tests**

Run:

```bash
npx vitest run tests/unit/verifiedAssetLoader.test.ts tests/unit/SharedRequestPool.test.ts tests/unit/ManifestStore.test.ts
npm run test:unit
npm run build
```

Expected: all tests PASS, retries have exact attempt counts, and no test emits an unhandled rejection.

- [ ] **Step 8: Commit the transport slice**

Run:

```bash
git add src/data/verifiedAssetLoader.ts src/data/SharedRequestPool.ts src/data/ManifestStore.ts tests/unit/verifiedAssetLoader.test.ts tests/unit/SharedRequestPool.test.ts tests/unit/ManifestStore.test.ts tests/helpers/catalogResponses.ts
git diff --cached --check
git commit -m "feat: verify and coalesce catalog assets"
```

Expected: one transport/cache commit with no Coordinator or UI changes.

### Task 6: Add Session-Isolated Repositories and a Byte-Bounded Shard LRU

**Depends on:** Tasks 4 and 5, plus Phase 1 Task 4.

**Files:**

- Modify: `package.json`
- Modify: `src/data/CatalogRepository.ts`
- Create: `src/data/MonolithCatalogRepository.ts`
- Create: `src/data/ShardedCatalogRepository.ts`
- Create: `src/data/ShardLru.ts`
- Create: `tests/unit/ShardLru.test.ts`
- Create: `tests/integration/catalogRepository.test.ts`
- Modify: `tests/helpers/catalogResponses.ts`

- [ ] **Step 1: Write RED LRU tests for both simultaneous limits and pins**

Test count and raw-byte limits independently and together. Use manifest `AssetRef.bytes`, never `JSON.stringify(parsed).length` or JS heap estimates.

```ts
it('evicts oldest unpinned entries until count and bytes both fit', () => {
  const lru = new ShardLru<string>({ maxEntries: 3, maxBytes: 10 })
  lru.set('a', cached('a', 4))
  lru.set('b', cached('b', 4))
  lru.setPinned(new Set(['a']))
  lru.set('c', cached('c', 4))

  expect(lru.keys()).toEqual(['a', 'c'])
  expect(lru.totalBytes).toBe(8)
})

it('reports an ordered raw-byte fingerprint including pins', () => {
  const lru = populatedLru()
  expect(lru.fingerprint()).toEqual([
    { key: 'root:v2:spect:abc', sha256: 'abc', bytes: 4, pinned: true },
    { key: 'root:v2:port:def', sha256: 'def', bytes: 4, pinned: false },
  ])
})
```

Define the two test helpers locally so their insertion order is explicit:

```ts
function cached(value: string, bytes: number) {
  return { value, sha256: value, bytes }
}

function populatedLru() {
  const lru = new ShardLru<string>({ maxEntries: 8, maxBytes: 32 })
  lru.set('root:v2:spect:abc', cached('abc', 4))
  lru.set('root:v2:port:def', cached('def', 4))
  lru.setPinned(new Set(['root:v2:spect:abc']))
  return lru
}
```

Add tests for recency on `get`, a pinned oldest entry, pinning a key before its request resolves, unpin-triggered eviction, update without double-counting bytes, and low-memory limits of 4 entries/4 MiB.

- [ ] **Step 2: Write RED repository tests for immutable sessions and lazy requests**

Use real generated fixture bytes through the fake fetch router. Assert:

- `bootstrap()` requests only `manifest.json` and returns a frozen session.
- A session key contains schema major, `catalogVersion`, `layoutVersion`, and an immutable fingerprint of the exact validated manifest bytes/ref map.
- `ensureRoot(oldSession, rootId)` cannot resolve a ref from a newer manifest.
- Same root/ref requests coalesce.
- Root cache keys contain session key, root ID, and AssetRef SHA-256.
- `ensureSector()` and `ensureRoot()` parse references against their supplied session.
- `ensureWordIndex()` remains idle until called.
- A 404 refresh whose manifest fingerprint and exact AssetRef are unchanged retries that same ref once in the supplied session.
- A 404 refresh with any changed manifest fingerprint or AssetRef creates a new immutable session and throws `CatalogSupersededError` carrying that staged session; it does not activate it or expose its refs through the old session, even when `catalogVersion` and `layoutVersion` strings are unchanged.
- Network manifest failure reads validated LKG.
- No network manifest and no LKG activates the monolith compatibility repository.
- Existing LKG plus a missing required asset returns a retryable navigation error and does not mix in monolith data.

- [ ] **Step 3: Verify RED**

Run:

```bash
npx vitest run tests/unit/ShardLru.test.ts tests/integration/catalogRepository.test.ts
```

Expected: FAIL because `ShardLru`, `ShardedCatalogRepository`, and the extended interface do not exist.

- [ ] **Step 4: Lock the repository contract around explicit sessions**

Refactor the Phase 1 class into `MonolithCatalogRepository.ts` without changing its source URLs or validated `Catalog`. Make `CatalogRepository.ts` export this exact contract:

```ts
export interface CatalogSession {
  key: string
  manifestFingerprint: string
  mode: 'monolith' | 'sharded'
  source: 'network' | 'last-known-good' | 'bundled-monolith'
  manifestUrl: string
  manifest: Readonly<CatalogManifestV2>
}

export interface RepositoryLoadOptions {
  signal: AbortSignal
}

export interface RepositoryDiagnostics {
  pendingRequests: number
  activeSessionKey: string | null
  lruEntries: number
  lruBytes: number
  lruFingerprint: readonly Readonly<{
    key: string
    sha256: string
    bytes: number
    pinned: boolean
  }>[]
  lastKnownGoodAvailable: boolean
}

export interface CatalogRepository {
  bootstrap(options: RepositoryLoadOptions): Promise<Readonly<CatalogSession>>
  ensureWordIndex(session: CatalogSession, options: RepositoryLoadOptions): Promise<Readonly<WordIndexV2>>
  ensureSector(session: CatalogSession, sectorId: string, options: RepositoryLoadOptions): Promise<Readonly<SectorIndexV2>>
  ensureRoot(session: CatalogSession, rootId: string, options: RepositoryLoadOptions): Promise<Readonly<RootShardV2>>
  setPinnedRoots(session: CatalogSession, rootIds: ReadonlySet<string>): void
  acceptReadySession(session: CatalogSession): Promise<void>
  getDiagnostics(): Readonly<RepositoryDiagnostics>
  dispose(): Promise<void>
}
```

The monolith adapter synthesizes an immutable in-memory overview, one deterministic compatibility sector, word index, sector index, and root shards, then uses the same projector as sharded mode. It preserves every original field and relation and leaves progress storage untouched.

- [ ] **Step 5: Implement `ShardLru` and repository keying**

`ShardLru` accepts values through `set(key, { value, sha256, bytes })`, exposes `get`, `setPinned`, ordered `keys`, `totalBytes`, and `fingerprint`, and stores parsed frozen shard plus AssetRef SHA and raw bytes. Count pinned entries in both limits. Set pending target pins before starting a cold request so insertion cannot evict the target. Use `navigator.deviceMemory <= 4` when available; inject the detected limit in tests.

Key every in-flight and parsed root as:

```ts
export function catalogSessionKey(manifest: CatalogManifestV2, manifestFingerprint: string): string {
  return `v${manifest.schemaVersion}:${manifest.catalogVersion}:${manifest.layoutVersion}:${manifestFingerprint}`
}

export function rootCacheKey(session: CatalogSession, rootId: string, ref: AssetRef): string {
  return `root:${session.key}:${rootId}:${ref.sha256}`
}
```

The fingerprint is derived from canonical validated manifest bytes and therefore changes whenever any AssetRef mapping changes. Sector and word-index keys follow the same session/ref rule. A late result may populate only its exact immutable cache key; it cannot change active session, scene, camera, selection, or pins.

- [ ] **Step 6: Implement sharded bootstrap and manifest refresh without catalog mixing**

Fetch `${import.meta.env.BASE_URL}data/v2/manifest.json` with `cache: 'no-cache'`. Parse it before creating the session. Keep network and LKG sessions explicit. Do not write LKG during `bootstrap()`.

On root/sector 404, refresh and validate the manifest once and compute its fingerprint from the canonical validated bytes, including the complete AssetRef map. A refreshed manifest always constructs a new immutable session object. Only when its fingerprint equals the supplied session's fingerprint and the requested AssetRef is byte-for-byte identical may the repository retry that same ref through the supplied session. Any fingerprint or ref-map change throws `CatalogSupersededError(newSession)` and lets Coordinator stage all data required by the new session while the current scene remains visible. Never attach a refreshed AssetRef to an old session, even when schema, `catalogVersion`, and `layoutVersion` are equal.

Implement repository creation with compile-time mode validation:

```ts
export type DataMode = 'monolith' | 'sharded'

export function parseDataMode(value: string | undefined): DataMode {
  if (value === undefined || value === '') return 'sharded'
  if (value === 'monolith' || value === 'sharded') return value
  throw new Error(`Unsupported VITE_DATA_MODE: ${value}`)
}
```

In sharded mode, fall back to bundled monolith only when both network manifest and LKG are unavailable during initial bootstrap. Do not fall back for a failed shard under an already accepted catalog.

- [ ] **Step 7: Persist LKG only after an explicit readiness acknowledgment**

`acceptReadySession(session)` must first check that the supplied key still matches the repository's staged or active session. Then write only a sharded manifest to `ManifestStore` and set it active. Calling it twice is idempotent. Monolith mode is a no-op. Coordinator may call this asynchronous method only inside the serialized commit section defined in Task 8, after the correct business frame and final pre-lock stale check; repository activation is therefore never interleaved with another Coordinator commit. Repository disposal aborts all transports, settles consumers, clears parsed memory, and rejects future calls with a lifecycle error.

- [ ] **Step 8: Verify GREEN and both data modes**

Add `"test:integration": "vitest run tests/integration"` to `package.json` before running the matrix; keep integration discovery separate from the Phase 1 unit/component include.

Run:

```bash
npx vitest run tests/unit/ShardLru.test.ts tests/integration/catalogRepository.test.ts
npm run test:integration
VITE_DATA_MODE=monolith npm run build
VITE_DATA_MODE=sharded npm run build
```

Expected: all tests and both builds PASS. The sharded repository test request log shows only manifest at bootstrap.

- [ ] **Step 9: Commit the repository slice**

Run:

```bash
git add package.json src/data/CatalogRepository.ts src/data/MonolithCatalogRepository.ts src/data/ShardedCatalogRepository.ts src/data/ShardLru.ts tests/unit/ShardLru.test.ts tests/integration/catalogRepository.test.ts tests/helpers/catalogResponses.ts
git diff --cached --check
git commit -m "feat: add byte bounded shard repository"
```

Expected: one repository/cache commit; no Store, Coordinator, renderer, or component files are staged.

### Task 7: Project Bounded LOD Scenes and Render New Node Kinds

**Depends on:** Tasks 4 and 6, plus Phase 1 Tasks 3 and 6.

**Files:**

- Modify: `src/render/contracts.ts`
- Modify: `src/graph/graphModel.ts`
- Create: `src/graph/fallbackLayout.ts`
- Create: `src/scene/projectCatalogScene.ts`
- Modify: `src/render/LegacyForceGraphRenderer.ts`
- Modify: `src/render/graphRuntime.ts`
- Create: `tests/unit/sceneProjection.test.ts`
- Modify: `tests/unit/graphModel.test.ts`
- Modify: `tests/integration/rendererContract.test.ts`
- Modify: `tests/fixtures/catalogFactory.ts`

- [ ] **Step 1: Write RED tests for direct overview and sector overview**

Assert direct overview for 72 and 300 roots contains every root, no word nodes, and at most 600 root aggregate edges. Assert CAT10K and ROOT2K overview contains only sector nodes and at most 128 sector edges. Sector entry must contain at most 200 roots, 32 sector portals, and 600 overview edges.

```ts
it('uses sector overview only above 300 roots', () => {
  const fixture = createCatalogFixture('CAT10K')
  const snapshot = projectCatalogScene(createProjectionInput(fixture, { kind: 'overview' }))
  expect(snapshot.nodes.every((node) => node.kind === 'sector')).toBe(true)
  expect(snapshot.visibleCounts.roots).toBe(0)
  expect(snapshot.visibleCounts.sectors).toBeLessThanOrEqual(64)
  expect(snapshot.visibleCounts.overviewEdges).toBeLessThanOrEqual(128)
})
```

- [ ] **Step 2: Write RED tests for root/word LOD and global portal grouping**

Use the LOD_MAX fixture and assert exact counts: 200 roots, 32 sector portals, 64 root portals, 600 words, 600 member edges, 2,400 word-relation edges, and 600 overview edges.

Add this global grouping case:

```ts
it('creates one root portal per remote root across all visible local roots', () => {
  const snapshot = projectCatalogScene(createTwoRootPortalProjectionInput())
  const portals = snapshot.nodes.filter((node) => node.kind === 'root-portal')
  expect(portals.map((node) => node.key)).toEqual(['portal:root:remote-root'])
  expect(snapshot.sidecars.portals['portal:root:remote-root']).toMatchObject({
    kind: 'root',
    contributingLocalRootIds: ['local-a', 'local-b'],
  })
})
```

Use 1,200 cross projections pointing to 1,200 remote roots. Without a priority relation, assert 64 portals selected by relation count descending and remote root ID ascending. With the 1,200th relation as `priorityRelationId`, assert its group replaces the lowest-priority visible group.

For every root portal sidecar, assert `relationIds.length === remoteWordIds.length`, entries at each index refer to the same relation, arrays are relation-ID sorted, and `contributingLocalRootIds` is independently unique and sorted.

- [ ] **Step 3: Write RED tests for transition deduplication, word cards, and fallback layout**

When both endpoint shards are visible, assert one real word-to-word edge per relation ID and no portal for the now-visible remote root. Assert word-card sidecars retain all canonical relations, including relations omitted by portal LOD, and contain complete validated Word and Root fields.

Inject valid content with non-finite root/orbit layout and assert deterministic ring/orbit fallback. Inject a missing word field, invalid endpoint, or missing root and assert the entire asset is rejected rather than laid out.

- [ ] **Step 4: Verify RED**

Run:

```bash
npx vitest run tests/unit/sceneProjection.test.ts tests/unit/graphModel.test.ts tests/integration/rendererContract.test.ts
```

Expected: FAIL because Phase 2 node variants and projector do not exist.

- [ ] **Step 5: Extend the existing renderer-neutral contract without changing methods**

Keep `GraphRenderer` unchanged. Extend `SceneNode` with these fields on top of Phase 1 `SceneNodeBase { key, entityId, label, sublabel, color, size, position }`:

```ts
export interface SectorSceneNode extends SceneNodeBase {
  kind: 'sector'
  sectorId: string
  rootCount: number
  position: readonly [number, number, number]
}

export interface SectorPortalSceneNode extends SceneNodeBase {
  kind: 'sector-portal'
  fromSectorId: string
  targetSectorId: string
  relationCount: number
  position: readonly [number, number, number]
}

export interface RootPortalSceneNode extends SceneNodeBase {
  kind: 'root-portal'
  targetRootId: string
  relationCount: number
  position: readonly [number, number, number]
}

export type PortalSidecar =
  | Readonly<{
      kind: 'sector'
      target: { kind: 'sector'; sectorId: string }
      relationCount: number
    }>
  | Readonly<{
      kind: 'root'
      target: { kind: 'root'; rootId: string }
      relationIds: readonly string[]
      remoteWordIds: readonly string[]
      contributingLocalRootIds: readonly string[]
    }>
```

Phase 2 root nodes carry `sectorId` and `wordCount`; Phase 2 word nodes carry a non-null `WordOrbit`. Keep edge endpoint fields named `source` and `target`, and edge kinds `overview | member | word-relation`. Keep visible counts exactly `sectors`, `roots`, `portals`, `words`, `memberEdges`, `wordRelationEdges`, and `overviewEdges`.

- [ ] **Step 6: Implement one pure projector and deterministic caps**

Use this input boundary:

```ts
export interface CatalogProjectionInput {
  session: Readonly<CatalogSession>
  target: Readonly<ViewTarget>
  viewEpoch: number
  manifest: Readonly<CatalogManifestV2>
  sectorIndex: Readonly<SectorIndexV2> | null
  visibleRootShards: readonly Readonly<RootShardV2>[]
  transitionRootId: string | null
  progress: Readonly<Record<string, Progress>>
  priorityRelationId: string | null
}

export function projectCatalogScene(input: CatalogProjectionInput): Readonly<SceneSnapshot>
```

In `tests/fixtures/catalogFactory.ts`, add `createProjectionInput(fixture, target, options?)` that compiles the fixture in memory, creates an immutable test `CatalogSession`, selects the required sector/root assets, sets epoch 1 and empty progress, and returns `CatalogProjectionInput`. Add `createTwoRootPortalProjectionInput()` with local roots `local-a` and `local-b`, remote root `remote-root`, and two cross relations sorted by their stable IDs. These helpers are test-only and write no files.

For root context, place the current root first, then related roots by aggregate count descending and root ID ascending, then remaining roots by manifest order, stopping at 200. Select sector portals by count descending and target sector ID ascending, stopping at 32.

Group all cross projections in the entire snapshot by remote root ID after removing relations whose two word endpoints are visible. Sort each group's relations by relation ID. Sort groups by whether they contain `priorityRelationId`, relation count descending, then remote root ID ascending; retain 64. Generate key `portal:root:<remote-root-id>` once per retained group. Never remove omitted relations from word-card sidecars.

Build a new frozen `SceneIndexes` from the final arrays. Assert all formal caps before returning; exceeding a cap is a projector error, not an extra silent trim.

- [ ] **Step 7: Implement deterministic layout-only fallback**

`fallbackLayout.ts` derives finite ring positions and word orbit parameters from stable typed IDs. The repository must first call `parseRootShardContentV2(raw, manifest, rootId)` and retain only its deeply frozen validated result. It then calls `parseRootShardLayoutV2(raw, content)`; only a `CatalogLayoutError` from this second stage may be replaced by `createFallbackRootShardLayout(content)` and `assembleRootShardV2(content, fallbackLayout)`. A content or reference error remains fatal, and no fallback path may read fields from `raw` again. Record a repository/coordinator diagnostic when fallback is used.

- [ ] **Step 8: Teach the Legacy adapter the new discriminants**

Render sector, sector portal, and root portal nodes through the existing Phase 1 resource registry. Map clicks to their typed navigation targets. Set `fx`, `fy`, and `fz` from every Phase 2 node position and never reheat D3. Update word orbits directly from `WordOrbit` in the single Phase 1 FrameScheduler and update only indexed affected edges.

The Legacy adapter must not import repository modules or inspect AssetRefs. It consumes only `SceneSnapshot`.

- [ ] **Step 9: Verify GREEN and the shared fixture contract**

Run:

```bash
npx vitest run tests/unit/sceneProjection.test.ts tests/unit/graphModel.test.ts tests/integration/rendererContract.test.ts
npm run test:unit
npm run test:integration
npm run build
```

Expected: all tests PASS, C0/CAT5K/CAT10K/ROOT2K LOD bounds are deterministic, portal arrays align, and Legacy metrics report zero D3 ticks after load.

- [ ] **Step 10: Commit the projection and Legacy-rendering slice**

Run:

```bash
git add src/render/contracts.ts src/graph/graphModel.ts src/graph/fallbackLayout.ts src/scene/projectCatalogScene.ts src/render/LegacyForceGraphRenderer.ts src/render/graphRuntime.ts tests/unit/sceneProjection.test.ts tests/unit/graphModel.test.ts tests/integration/rendererContract.test.ts tests/fixtures/catalogFactory.ts
git diff --cached --check
git commit -m "feat: project bounded catalog scenes"
```

Expected: one renderer-neutral LOD commit; no repository network or React component changes are staged.

### Task 8: Make Coordinator Navigation Atomic Across Network, Store, and Renderer

**Depends on:** Tasks 6 and 7, plus Phase 1 Tasks 5 and 7.

**Files:**

- Modify: `src/store/useStore.ts`
- Modify: `src/scene/SceneCoordinator.ts`
- Create: `src/scene/catalogUiSnapshot.ts`
- Modify: `tests/unit/useStore.test.ts`
- Modify: `tests/integration/sceneCoordinator.test.ts`

- [ ] **Step 1: Write RED Store tests for requested versus committed navigation**

Keep the committed `target` unchanged until Coordinator acknowledges the matching Phase 1 request sequence, while preserving the original event timestamp:

```ts
it('does not expose an unloaded target as committed state', () => {
  const store = createStarStore(createMemoryStorage())
  store.getState().navigate({ kind: 'root', rootId: 'spect' }, 321.5)
  const request = store.getState().navigationRequest

  expect(store.getState().target).toEqual({ kind: 'overview' })
  expect(request?.target).toEqual({ kind: 'root', rootId: 'spect' })
  expect(request?.eventTimeStamp).toBe(321.5)

  store.getState().commitNavigation(request!.sequence)
  expect(store.getState().target).toEqual({ kind: 'root', rootId: 'spect' })
})
```

Add tests that stale request sequences cannot commit, rejection retains target, repeated word navigation increments nonce, raw `eventTimeStamp` survives requested and committed state unchanged, and `priorityRelationId` is coordinator-local metadata keyed by request sequence rather than part of `NavigationRequest` or `ViewTarget`. Also lock request A with `beginNavigationCommit`, navigate B then C, and assert A remains `navigationRequest`, only C remains queued with its exact timestamp, and committing/rejecting A atomically promotes C.

- [ ] **Step 2: Write RED Coordinator tests for first load, latest-wins, and rollback**

Using deferred repository and renderer promises, assert:

- Startup calls only `bootstrap()`, projects overview, and calls `loadScene()` once.
- `acceptReadySession()` occurs only after `loadScene()` resolves its correct business frame and the request enters Coordinator's serialized commit section. If a newer intent arrives while acceptance is deferred, it queues until session/Store/UI commit finishes, then starts as the next epoch; no repository/Coordinator mixed state is observable.
- Ten root intents resolved in reverse order commit only the tenth epoch.
- Root load or renderer failure leaves old target, scene, word card, and root pins unchanged.
- A cross-root word jump loads the target root directly without sector index.
- The old and target clusters are pinned during transition; the old root unpins only after final one-cluster scene resolves.
- Replaced sector and root consumers abort; shared transports with another consumer remain alive.
- A `CatalogSupersededError` stages manifest and target shard from the new session, then commits them together; only after the new session's correct renderer business frame does Coordinator await `acceptReadySession(newSession)`, publish that exact session as current, and commit Store/UI state. Assert repository `activeSessionKey`, persisted LKG fingerprint, Coordinator current session, scene, and target all identify the same new session; no old-session asset enters the new snapshot.
- Dispose aborts and settles pending work before repository and renderer release.

- [ ] **Step 3: Verify RED**

Run:

```bash
npx vitest run tests/unit/useStore.test.ts tests/integration/sceneCoordinator.test.ts
```

Expected: FAIL because Store has no navigation request state and Coordinator still assumes monolith bootstrap.

- [ ] **Step 4: Add explicit navigation request state without changing progress storage**

Keep the Phase 1 envelope in `src/types.ts` exactly unchanged:

```ts
export interface NavigationRequest {
  readonly sequence: number
  readonly target: ViewTarget
  readonly eventTimeStamp: number | null
}

interface State {
  target: ViewTarget
  navigationRequest: NavigationRequest | null
  queuedNavigationRequest: NavigationRequest | null
  navigationCommitSequence: number | null
  navigationError: string | null
  navigate: (intent: NavigationIntent, eventTimeStamp?: number | null) => NavigationRequest
  beginNavigationCommit: (sequence: number) => boolean
  commitNavigation: (sequence: number) => void
  rejectNavigation: (sequence: number, message: string) => void
}
```

`navigate()` creates and returns the same monotonically increasing Phase 1 envelope and leaves committed target untouched. Normally it publishes that envelope as `navigationRequest`. After `beginNavigationCommit(sequence)` succeeds, the matching request remains current and any later `navigate()` writes only `queuedNavigationRequest`, replacing an older queued request so the latest intent wins while preserving its own sequence/nonce/raw timestamp. It must not replace the request being committed. `commitNavigation()` moves only the matching sequence's target into `target`, retains that request's exact raw `eventTimeStamp` for committed-frame latency accounting, clears the commit marker, and atomically promotes the queued request. `rejectNavigation()` retains committed target, clears the matching commit marker, and likewise promotes the queued request. Keep synchronous `star-vocab-progress-v1` writes and payload exactly unchanged.

Keep the Phase 1 factory name `createStarStore(storage: Pick<Storage, 'getItem' | 'setItem'>)` and its production bound hook. Tests use the Phase 1 `createMemoryStorage()` helper, so every Store test has isolated persistence without changing production timing. Coordinator stores `priorityRelationId` only in a private sequence-keyed metadata map when an intent is received, removes it on commit/reject/abort, and passes it to `CatalogProjectionInput`; it never widens or reconstructs `NavigationRequest`.

- [ ] **Step 5: Implement startup readiness and deferred word-index scheduling**

Coordinator startup sequence is: bootstrap session, project overview from manifest only, call renderer `loadScene`, verify returned frame epoch/counts through the Phase 1 contract, perform a final stale check, then enter the same serialized commit section used for navigation. Inside it, await `acceptReadySession(session)`, publish that exact object as Coordinator current session, commit overview/UI, and open the word-index gate before releasing queued intents.

After that gate, load word index immediately only for non-empty search, random-word request, or cross-root next-word request. Otherwise schedule one idle load no earlier than 1,000 ms after readiness. Opening Sidebar with an empty query does not count as demand. Cancel idle prefetch when `document.hidden`, `saveData` is true, or effective connection type is 2G.

- [ ] **Step 6: Implement atomic sector/root/word transitions**

For every navigation request:

1. Increment `viewEpoch` and abort the preceding consumer.
2. Keep committed Store target, current UI snapshot, current renderer scene, and current root pins unchanged.
3. Optionally execute a preview camera command toward an already-visible root or portal.
4. Load the exact sector/root assets through the current explicit session.
5. Build a frozen candidate scene and UI snapshot.
6. Recheck epoch, session key, request sequence, and signal before `loadScene`.
7. Await the correct renderer business frame, recheck all four values again, then call `renderer.execute({ kind: 'navigate', viewEpoch, request })` with the exact frozen Phase 1 `NavigationRequest` object; never reconstruct its sequence, target, or `eventTimeStamp`.
8. After the final stale check and with no intervening await, call Store `beginNavigationCommit(request.sequence)`; if it returns false, take the stale path. Then enter a Coordinator commit mutex. This is the request's linearization point: Store keeps the exact request being committed, while intents received during the mutex become `queuedNavigationRequest` and do not abort or start another epoch. If this candidate uses a newly staged session, await `acceptReadySession(candidateSession)` inside the mutex, then publish that exact object as Coordinator `currentSession`.
9. Still inside the mutex and with no further await, commit Store target by the same request sequence, publish the UI snapshot, and update final pins. Repository `activeSessionKey`, active LKG fingerprint, Coordinator session, scene, and UI snapshot must all name the same session before the mutex releases. Then start only the newest queued intent as the next epoch. A candidate that is stale before entering the mutex never calls `acceptReadySession`.

On any non-abort failure before candidate frame submission, publish a retryable error while retaining the prior visible state. If session acceptance fails after a candidate business frame, reload and await the retained previous snapshot before calling `rejectNavigation(A.sequence)` to release/promote the queue; if that renderer rollback also fails, enter the Phase 1 terminal Static fallback with the retained validated session rather than leaving mixed state. On abort before commit linearization, release only candidate pins and remain silent; a newer epoch is responsible for replacing any superseded submitted frame. Add a deferred-acceptance race test: A reaches the commit mutex, B and then C arrive while A's `ManifestStore.write` is suspended, `navigationRequest` remains A and the queue retains C with its raw timestamp, A completes one coherent repository/Coordinator/Store/UI commit, C is atomically promoted, and only then C starts and ultimately commits. At no assertion point may active session, LKG, scene, target, or UI name different sessions.

For cross-root transitions, first submit a two-cluster snapshot capped by Task 7, commit the new word only after that frame succeeds, then submit the final one-cluster snapshot after camera transition completion. If cleanup load fails, retain the valid transition scene and retry cleanup without reverting the selected word.

- [ ] **Step 7: Publish immutable UI snapshots without putting catalog data in Store**

`catalogUiSnapshot.ts` must expose manifest counts/root summaries, word-index state, loaded shard words, current word-card sidecar, retry state, and catalog/view epoch as frozen data. Coordinator publishes it through a host callback. Store continues to contain semantic state and intents only; it never stores root shards, AssetRefs, repository instances, or Three objects.

- [ ] **Step 8: Verify GREEN and architecture boundaries**

Run:

```bash
npx vitest run tests/unit/useStore.test.ts tests/integration/sceneCoordinator.test.ts
npm run test:integration
npm run build
rg -n "from ['\"]../store/useStore|from ['\"].*/store/useStore" src/data src/render
```

Expected: tests and build PASS. The final `rg` command reports no Store import from data or renderer modules; `SceneCoordinator.ts` remains the only non-React 3D Store subscriber.

- [ ] **Step 9: Commit the atomic navigation slice**

Run:

```bash
git add src/store/useStore.ts src/scene/SceneCoordinator.ts src/scene/catalogUiSnapshot.ts tests/unit/useStore.test.ts tests/integration/sceneCoordinator.test.ts
git diff --cached --check
git commit -m "feat: load catalog navigation atomically"
```

Expected: the commit contains Store/Coordinator lifecycle changes only and preserves the progress key and payload.

### Task 9: Connect App UI and StaticCatalogView to Deferred Catalog Data

**Depends on:** Task 8 and Phase 1 Task 10.

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/components/StarMap.tsx`
- Modify: `src/components/StaticCatalogView.tsx`
- Create: `src/components/VirtualCatalogList.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Controls.tsx`
- Modify: `src/components/WordCard.tsx`
- Modify: `src/components/Hud.tsx`
- Modify: `src/index.css`
- Modify: `src/store/useStore.ts`
- Modify: `src/scene/SceneCoordinator.ts`
- Create: `tests/unit/StaticCatalogView.test.tsx`
- Create: `tests/unit/VirtualCatalogList.test.tsx`
- Create: `tests/integration/catalogUi.test.tsx`
- Create: `tests/helpers/reactHarness.tsx`
- Modify: `tests/fixtures/catalogFactory.ts`

- [ ] **Step 1: Write RED tests for the static readiness contract**

Render `StaticCatalogView` with a manifest-only overview snapshot, a controlled `requestAnimationFrame`, `createRoot`, and `act`. Add `createStaticOverviewSnapshot()` to `tests/fixtures/catalogFactory.ts` and add `mountWithAct()` plus cleanup to `tests/helpers/reactHarness.tsx`.

```tsx
import { act } from 'react'
import { createRoot, type Root as ReactRoot } from 'react-dom/client'

it('reports fallback-ready only after committed navigable content survives one frame', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root: ReactRoot = createRoot(host)
  const onReady = vi.fn()
  const snapshot = createStaticOverviewSnapshot()
  let queuedFrame: FrameRequestCallback | null = null
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queuedFrame = callback
    return 1
  })

  await act(async () => {
    root.render(
      <StaticCatalogView snapshot={snapshot} onIntent={vi.fn()} onReady={onReady} />,
    )
  })

  const spect = host.querySelector<HTMLButtonElement>('[data-catalog-key="root:spect"]')
  expect(spect?.disabled).toBe(false)
  expect(onReady).not.toHaveBeenCalled()
  await act(async () => { queuedFrame?.(16) })
  expect(onReady).toHaveBeenCalledWith(expect.objectContaining({
    catalogVersion: 'catalog-test',
    viewEpoch: 1,
    visibleCounts: snapshot.visibleCounts,
  }))

  await act(async () => { root.unmount() })
  host.remove()
})
```

Add tests that no ready callback occurs when DOM navigable counts do not match the snapshot; sector, sector portal, root, root portal, and word clicks emit the exact `ViewTarget`; a word relation click emits target root/word without consulting word index; and a new epoch emits one new readiness detail.

- [ ] **Step 2: Write RED tests for bounded catalog UI rendering**

Render ROOT2K root summaries and CAT10K word index through `VirtualCatalogList`. Assert fewer than 120 catalog row elements exist at once, keyboard focus can move to an offscreen target after scrolling, and visible row text remains inside its row at desktop and 412 px viewport widths.

Test Sidebar states separately:

- Empty query plus default-open Sidebar does not request word index.
- Non-empty query retains its text while index is loading.
- Index failure searches only loaded shard words and exposes one retry action.
- Ready index searches `word`, `def_zh`, and root grouping while preserving stable `order`.

- [ ] **Step 3: Write RED tests for random and next-word degradation**

Add Store intent actions with explicit request IDs and test these semantics:

- Random with ready index selects globally from unmastered entries.
- Random with failed index selects only from loaded shard unmastered words.
- Master-and-next prefers current shard; with ready index it may cross roots; with failed index it stays in the shard.
- When no fallback candidate exists, selection remains unchanged and retry state is visible.
- Direct relation navigation works while word index is idle or failed.

- [ ] **Step 4: Verify RED**

Run:

```bash
npx vitest run tests/unit/StaticCatalogView.test.tsx tests/unit/VirtualCatalogList.test.tsx tests/integration/catalogUi.test.tsx
```

Expected: FAIL because the components still expect complete prop arrays and do not implement deferred/static sector data.

- [ ] **Step 5: Make App a host for immutable UI data, not a data loader**

Remove every catalog `fetch()` from `App.tsx`. Hold the latest frozen `CatalogUiSnapshot` supplied by `StarMap` and pass view models to HUD, Sidebar, Controls, and WordCard.

Use this StarMap boundary:

```ts
export interface StarMapProps {
  onCatalogUiSnapshot: (snapshot: Readonly<CatalogUiSnapshot>) => void
}
```

`StarMap` continues to create and dispose Coordinator. Its local React state owns only display mode and the current `StaticCatalogSnapshot`; it does not read repository data. Pass `onStaticReady` back to Coordinator as the Static business-frame acknowledgment. Only after that exact `fallback-ready` signal may Coordinator perform its final stale check and enter the serialized startup commit section that calls `acceptReadySession()` and opens the word-index gate; the React callback never activates a repository session directly.

- [ ] **Step 6: Implement static sector/root/word rendering with exact intent callbacks**

`StaticCatalogView` receives only:

```ts
export interface StaticCatalogViewProps {
  snapshot: Readonly<StaticCatalogSnapshot>
  onIntent: (
    intent: NavigationIntent,
    eventTimeStamp: number | null,
    options?: { priorityRelationId?: string },
  ) => void
  onReady: (detail: StaticReadyDetail) => void
}
```

Render unframed, keyboard-navigable lists for the snapshot's visible sectors, roots, portals, and words. Every pointer/keyboard path forwards the browser event's raw `timeStamp`; programmatic paths pass `null`. Coordinator calls `createStarStore(...).navigate(intent, eventTimeStamp)` unchanged and records optional `priorityRelationId` only in its private sequence-keyed metadata. Render current word-card data from `snapshot.currentWord`, which originated in `SceneSnapshot.sidecars.wordCards`. Do not import `useStore`, repository modules, Three.js, or renderer modules.

After React commit, schedule one rAF, query `[data-catalog-item]` elements, compare their typed counts with `snapshot.visibleCounts`, then call `performance.mark('fallback-ready', { detail })` and `onReady(detail)`. Cancel the pending rAF when epoch or component lifetime changes.

- [ ] **Step 7: Implement a virtualized root/word list without an extra data owner**

`VirtualCatalogList` accepts a frozen flat row array, active key, row renderer, and selection callback. Use a fixed measured row-height table for group and item rows, scroll overscan of 8 rows, stable keys, and absolute positioning inside one spacer element. Keep keyboard navigation based on the complete row array, then scroll the requested index into view before focusing its mounted row.

Sidebar flattens root summaries and word-index entries from `CatalogUiSnapshot`; it does not fetch. HUD reads manifest totals and progress counts. WordCard reads the current sidecar only. Controls publish random/retry intents to Store; Coordinator resolves them with repository data.

- [ ] **Step 8: Add exact Store intent fields for non-navigation catalog commands**

Extend Store with monotonically increasing request records:

```ts
export type CatalogCommandRequest =
  | { requestId: number; kind: 'random-word' }
  | { requestId: number; kind: 'next-word'; currentWordId: string }
  | { requestId: number; kind: 'retry'; resource: 'manifest' | 'word-index' | 'sector' | 'root'; resourceId: string | null }

interface State {
  catalogCommandRequest: CatalogCommandRequest | null
  requestRandomWord: () => void
  requestNextWord: (currentWordId: string) => void
  retryCatalogResource: (resource: CatalogCommandRequest['resource'], resourceId?: string) => void
}
```

Coordinator is the only non-React subscriber and clears only the matching handled request. These commands do not change committed target before their required data succeeds.

- [ ] **Step 9: Verify GREEN, responsive DOM bounds, and import boundaries**

Run:

```bash
npx vitest run tests/unit/StaticCatalogView.test.tsx tests/unit/VirtualCatalogList.test.tsx tests/integration/catalogUi.test.tsx
npm run test:unit
npm run test:integration
npm run build
rg -n "fetch\(" src/App.tsx src/components
rg -n "useStore|CatalogRepository|three" src/components/StaticCatalogView.tsx
```

Expected: tests and build PASS. Both `rg` commands return no matches.

- [ ] **Step 10: Commit the React/static slice**

Run:

```bash
git add src/App.tsx src/components/StarMap.tsx src/components/StaticCatalogView.tsx src/components/VirtualCatalogList.tsx src/components/Sidebar.tsx src/components/Controls.tsx src/components/WordCard.tsx src/components/Hud.tsx src/index.css src/store/useStore.ts src/scene/SceneCoordinator.ts tests/unit/StaticCatalogView.test.tsx tests/unit/VirtualCatalogList.test.tsx tests/integration/catalogUi.test.tsx tests/helpers/reactHarness.tsx tests/fixtures/catalogFactory.ts
git diff --cached --check
git commit -m "feat: support deferred catalog navigation ui"
```

Expected: components consume only immutable UI/static snapshots, and `.serena/` remains unstaged.

### Task 10: Prove Fault Recovery and No-Blank-Scene Behavior

**Depends on:** Tasks 5 through 9.

**Files:**

- Create: `tests/helpers/faultFetch.ts`
- Create: `tests/integration/catalogFaults.test.ts`
- Create: `tests/browser/loading.spec.ts`
- Create: `tests/browser/navigation.spec.ts`
- Create: `tests/browser/fallback.spec.ts`
- Modify: `tests/helpers/static-server.mjs`
- Modify: `tests/helpers/canvas.ts`
- Modify if required by a RED recovery case: `src/data/verifiedAssetLoader.ts`
- Modify if required by a RED recovery case: `src/data/SharedRequestPool.ts`
- Modify if required by a RED recovery case: `src/data/ManifestStore.ts`
- Modify if required by a RED recovery case: `src/data/ShardedCatalogRepository.ts`
- Modify if required by a RED recovery case: `src/scene/SceneCoordinator.ts`
- Modify if required by a RED recovery case: `src/scene/catalogUiSnapshot.ts`
- Modify if required by a RED recovery case: `src/scene/createStaticCatalogSnapshot.ts`
- Modify if required by a RED recovery case: `src/store/useStore.ts`
- Modify if required by a RED recovery case: `src/components/StarMap.tsx`
- Modify if required by a RED recovery case: `src/components/StaticCatalogView.tsx`
- Modify if required by a RED recovery case: `src/components/Controls.tsx`

- [ ] **Step 1: Write RED integration tests for every required injected failure**

`faultFetch.ts` must route by exact URL and attempt number and return real `Response` objects or controlled pending promises. Add one independently named test for each condition:

- Manifest timeout, invalid JSON, incompatible schema, and network failure.
- Word index timeout, invalid JSON, byte mismatch, hash mismatch, and schema error.
- Sector and root 404 with same-version refresh.
- Sector and root 404 with new-version manifest.
- Root response timeout, invalid JSON, byte mismatch, hash mismatch, content reference error, and layout-only error.
- Ten root responses arriving newest-to-oldest and oldest-to-newest.
- One consumer abort and all-consumers abort.
- LKG available and LKG absent startup paths.
- Missing asset under accepted LKG without monolith mixing.

Every navigation-failure test must snapshot the previous renderer scene key, committed Store target, current word card, session key, and pinned roots before injection and assert all five remain after failure.

- [ ] **Step 2: Verify integration RED**

Run:

```bash
npx vitest run tests/integration/catalogFaults.test.ts
```

Expected: at least one required recovery assertion FAILS until all branches are wired through the production repository and Coordinator.

- [ ] **Step 3: Implement only the recovery branches demonstrated by failing tests**

For each failure, retain the last valid scene and publish a retry state. Treat `AbortError` as silent. Retry transient transport exactly as Task 5 specifies. Replace layout only for classified layout errors. Reject content/reference errors. On catalog supersession, stage a complete candidate under the new session before activation.

Add a single top-level `unhandledrejection` recorder to the test harness; production code must settle or intentionally catch every replaced load. Do not add a global production rejection suppressor.

- [ ] **Step 4: Write browser RED tests for request ordering and navigation**

In `loading.spec.ts`, use a new browser context with cleared storage/cache and assert the request sequence:

1. Before `first-scene-frame`, only `data/v2/manifest.json` is requested.
2. Default-open Sidebar does not request word index before readiness.
3. Word-index `PerformanceResourceTiming.startTime` is greater than the correct readiness mark.
4. Direct overview requests neither sector index nor root shard.
5. Sector entry requests one coalesced sector index; root entry requests one coalesced root shard.

In `navigation.spec.ts`, exercise overview, sector, root, word, portal, search, random, next-word, back navigation, drag, zoom, Bloom, and progress persistence. Route ten roots with controlled delays and assert only the last target's `first-scene-frame` detail and word card appear.

- [ ] **Step 5: Write browser RED tests for static fallback readiness**

Override WebGL2 context acquisition before app code runs. Assert manifest renders as navigable DOM, `fallback-ready` occurs only after its next rAF and carries exact catalog/version/count detail, and word index starts after that mark. Navigate sector, root, remote portal, and word entirely through DOM.

Then inject Legacy renderer initialization failure and assert Coordinator disposes it before publishing one static snapshot. Assert no blank canvas placeholder remains and no recursive renderer retry occurs.

- [ ] **Step 6: Verify browser RED**

Run:

```bash
npm run build
npx playwright test -c playwright.config.ts tests/browser/loading.spec.ts tests/browser/navigation.spec.ts tests/browser/fallback.spec.ts
```

Expected: tests initially FAIL on the first missing request-order, fallback, or navigation guarantee rather than on server startup.

- [ ] **Step 7: Complete browser-visible recovery and retry states**

Wire Coordinator errors into `CatalogUiSnapshot` and Static snapshot with one retry command. Keep the canvas or DOM representation of the previous scene mounted during retry. A retry starts a new epoch and reuses only verified cached assets from the same session.

Update the benchmark static server to send `Cache-Control: no-cache` for `/data/v2/manifest.json` and `Cache-Control: public,max-age=31536000,immutable` for hash-addressed v2 assets. Preserve its pre-generated gzip behavior.

- [ ] **Step 8: Verify GREEN across integration and browser suites**

Run:

```bash
npx vitest run tests/integration/catalogFaults.test.ts
npm run test:integration
npm run build
npx playwright test -c playwright.config.ts tests/browser/loading.spec.ts tests/browser/navigation.spec.ts tests/browser/fallback.spec.ts
```

Expected: all tests PASS; no test reports `unhandledrejection`, unexpected monolith fetch, blank scene, stale card, or mixed session.

- [ ] **Step 9: Commit the fault-recovery slice**

Run:

```bash
git add tests/helpers/faultFetch.ts tests/integration/catalogFaults.test.ts tests/browser/loading.spec.ts tests/browser/navigation.spec.ts tests/browser/fallback.spec.ts tests/helpers/static-server.mjs tests/helpers/canvas.ts src/data/verifiedAssetLoader.ts src/data/SharedRequestPool.ts src/data/ManifestStore.ts src/data/ShardedCatalogRepository.ts src/scene/SceneCoordinator.ts src/scene/catalogUiSnapshot.ts src/scene/createStaticCatalogSnapshot.ts src/store/useStore.ts src/components/StarMap.tsx src/components/StaticCatalogView.tsx src/components/Controls.tsx
git diff --cached --check
git commit -m "test: cover sharded catalog recovery"
```

Expected: staged production changes are limited to listed recovery owners that actually changed for RED tests; omit unchanged paths from the command. Inspect `git diff --cached --name-only` before committing; it must not include generated performance results, `.serena/`, or unrelated files. Never replace the explicit paths with a directory, `git add .`, or `git add -A`.

### Task 11: Gate LOD, Network, Interaction, and Heap Performance

**Depends on:** Tasks 4 through 10 and the Phase 1 performance harness.

**Files:**

- Modify: `tests/fixtures/catalogFactory.ts`
- Create: `tests/perf/phase2.spec.ts`
- Create: `tests/perf/phase2-heap.spec.ts`
- Create: `tests/perf/check-data-assets.mjs`
- Create: `scripts/run-phase2-d3.mjs`
- Modify: `tests/perf/perf.ts`
- Modify: `tests/perf/environment.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing static asset-budget checks**

`check-data-assets.mjs` must compile fixtures in memory with Node zlib level 9 and mtime 0, then fail on these exact budgets:

- 100-root manifest: at most 50 KiB gzip.
- ROOT2K manifest: at most 350 KiB gzip.
- Every sector index: at most 32 KiB gzip.
- Initial entry JavaScript: at most 120 KiB gzip.
- CAT5K first-scene HTML/CSS/entry/3D chunk/manifest: at most 650 KiB gzip.
- ROOT2K equivalent: at most 950 KiB gzip.

Also fail when initial request inventory includes monolith words, monolith wordlinks, word index, sector index, or root shard before the correct first readiness gate.

- [ ] **Step 2: Verify the static checks can fail**

Temporarily pass a 1-byte manifest budget through the test helper rather than editing a production constant.

Run:

```bash
node tests/perf/check-data-assets.mjs --fixture C2 --manifest-budget-bytes 1
```

Expected: exit code 1 with a manifest budget failure. Then run the real command:

```bash
node tests/perf/check-data-assets.mjs
```

Expected: PASS only when all real budgets and request inventories are within limits.

- [ ] **Step 3: Write Playwright performance tests for all Phase 2 scene paths**

Use production build and the benchmark static server. Add exact tests for:

- C0 direct overview.
- CAT5K direct overview and focused root.
- CAT10K sector entry and focused root.
- ROOT2K sector entry and focused root.
- Identical LOD_COMPARE projection from CAT5K, CAT10K, and ROOT2K.
- LOD_MAX load, click feedback, release, and absence of undeclared trim.

Use only `presentIntervalMs[i] = rafTimestamp[i] - rafTimestamp[i - 1]` for FPS and p95/p99 frame gates. Verify locked actual DPR from drawing buffer dimensions, not only `__STAR_PERF__`. Fail a run if quality state changes.

- [ ] **Step 4: Encode the exact performance assertions**

Assert:

- LOD_MAX on D1 locked balanced, DPR 1.25: median FPS at least 40, p95 interval at most 40 ms, click feedback p95 at most 200 ms, warm compile/commit at most 1 second, and no single long task over 100 ms.
- CAT5K on D1 locked balanced, DPR 1.25: median FPS at least 55, p95 interval at most 20 ms, and D3 tick count 0.
- D1 cold shard switch p95 at most 500 ms; D2 p95 at most 800 ms; memory-hot switch p95 at most 150 ms.
- LOD_COMPARE draw calls and p95 interval differ by at most 10% across CAT5K, CAT10K, and ROOT2K.
- D1 cold first scene p75 at most 1.5 seconds and p95 at most 2.5 seconds; D2 p75 at most 3 seconds and p95 at most 5 seconds.
- D3 completes 30 C0 direct-overview and CAT10K sector/root transitions with zero blank scenes, unhandled errors, or accidental monolith activation.

- [ ] **Step 5: Write the forced-GC LRU plateau test**

Fill LRU, then record a sentinel scene and ordered repository fingerprint. Switch through 30 deterministic roots. Replay the exact sentinel sequence until scene, key order, pins, SHA-256, and raw bytes all match baseline. Stop navigation/animation, wait for repository pending count 0 and two stable frames, call `HeapProfiler.collectGarbage` three times, then take three `Runtime.getHeapUsage().usedSize` samples one second apart and use their median.

Assert:

```ts
expect(finalUsedSize - baselineUsedSize)
  .toBeLessThanOrEqual(Math.max(5 * 1024 * 1024, baselineUsedSize * 0.10))
expect(finalMetrics.geometries - baselineMetrics.geometries).toBeLessThanOrEqual(2)
expect(finalMetrics.textures - baselineMetrics.textures).toBeLessThanOrEqual(2)
expect(finalMetrics.listeners - baselineMetrics.listeners).toBeLessThanOrEqual(2)
expect(finalMetrics.activeRafs - baselineMetrics.activeRafs).toBeLessThanOrEqual(2)
```

- [ ] **Step 6: Run focused performance RED and fix production behavior, never thresholds**

Add these scripts before running the RED matrix:

```json
{
  "perf:phase2": "playwright test -c playwright.perf.config.ts tests/perf/phase2.spec.ts tests/perf/phase2-heap.spec.ts",
  "perf:phase2:d3": "node scripts/run-phase2-d3.mjs"
}
```

Run:

```bash
npm run build:benchmark
npm run perf:precompress
npm run perf:phase2 -- --project=D1 --project=D2
```

Expected before final tuning: any missed budget fails with its measured metric and environment signature. For each failure, add or retain the smallest reproducing test, change the owning production module, and rerun this exact command. Do not lower a budget, reduce fixture data, disable Bloom/particles, or allow adaptive quality during locked tests.

- [ ] **Step 7: Run the complete D1 and D2 GREEN matrix**

Run:

```bash
npm run perf:bundle
npm run perf:phase2 -- --project=D1 --project=D2
```

Expected: every absolute budget passes. Saved reports include chip, memory, OS build, browser executable and major, viewport, 60 Hz refresh rate, device/actual DPR, WebGL vendor/renderer, power, low-power state, thermal state, and D2 throttling. A changed environment signature establishes a new baseline and performs no relative comparison to the old signature.

- [ ] **Step 8: Run the required Pixel 7a D3 matrix**

Run the same production artifact on the recorded Pixel 7a environment: fixed 60 Hz, Battery Saver off, landscape 915x412 CSS viewport, locked balanced DPR 1.25, Bloom and particles enabled. `scripts/run-phase2-d3.mjs` is the only command allowed to invoke the D3 project. It exports a side-effect-free reusable Pixel 7a preflight for later phase runners and executes its CLI body only when launched directly. It must fail closed unless `adb` exists, exactly one authorized device is attached, `ro.product.model` is `Pixel 7a`, `ro.product.device` is `lynx`, hardware rendering is active, refresh rate is fixed at 60 Hz, Battery Saver is off, the viewport/orientation matches D3, Chrome remote debugging is attached to that device, and thermal status is nominal before and after the run. It writes the device serial hash and preflight evidence into the release artifact; it never substitutes desktop Chrome, viewport emulation, or SwiftShader.

```bash
npm run perf:phase2:d3
```

Expected: 30 C0 and CAT10K startup/sector/root sequences complete with zero blank scenes, unhandled exceptions, progress loss, or accidental monolith fallback. Record thermal status before and after every scored run and exclude changed-thermal rounds from stable samples. Without this result, Phase 2 cannot be marked mobile-validated.

- [ ] **Step 9: Commit performance gates, not generated reports**

Run:

```bash
git add package.json scripts/run-phase2-d3.mjs tests/fixtures/catalogFactory.ts tests/perf/phase2.spec.ts tests/perf/phase2-heap.spec.ts tests/perf/check-data-assets.mjs tests/perf/perf.ts tests/perf/environment.ts
git diff --cached --check
git commit -m "perf: gate phase 2 catalog scaling"
```

Expected: the commit contains deterministic tests and harness changes only. Files below `test-results/` and `.serena/` remain unstaged.

### Task 12: Validate Assets-First Publication, Rollback, and Independent Release

**Depends on:** Tasks 1 through 11.

**Files:**

- Create: `scripts/verify-deployed-catalog.mjs`
- Create: `scripts/verify-phase2-release.mjs`
- Create: `docs/operations/catalog-v2-release.md`
- Modify: `README.md`
- Modify: `scripts/README.md`
- Modify: `package.json`
- Create: `tests/integration/dataMode.test.ts`
- Create: `tests/integration/deployedCatalogVerifier.test.ts`
- Create: `tests/integration/phase2ReleaseVerifier.test.ts`

- [ ] **Step 1: Write RED tests for data mode and deployed-origin verification**

`dataMode.test.ts` must build both modes and assert both produce the same renderer-neutral semantic keys/relations for C0, while request inventories differ as designed. Invalid `VITE_DATA_MODE` must fail startup clearly.

`deployedCatalogVerifier.test.ts` starts the benchmark static server and asserts the verifier rejects, one at a time: missing asset, wrong status, wrong raw bytes, wrong SHA-256, absolute AssetRef URL, an asset outside `/data/v2/`, and mutable cache headers on a hash asset. It must accept manifest `no-cache` and immutable hash assets.

`phase2ReleaseVerifier.test.ts` builds signed fixture artifacts and asserts the release verifier rejects missing or non-score-eligible D1/D2, a D3 report not produced by the Pixel 7a preflight runner, wrong model/device/GPU/refresh/thermal evidence, any failed absolute gate, missing bundle/data/rollback/deployed-origin evidence, an invalid or unknown signing key, mismatched artifact digests, a Phase 1 source that is not an ancestor, or Phase 2 reports naming different candidate commits. It accepts only one internally consistent all-green artifact set.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/integration/dataMode.test.ts tests/integration/deployedCatalogVerifier.test.ts tests/integration/phase2ReleaseVerifier.test.ts
```

Expected: FAIL because the deployed-catalog and Phase 2 release verifiers do not exist and publication/release evidence is not yet checked end to end.

- [ ] **Step 3: Implement the deployed catalog verifier**

The CLI accepts exactly `--origin <http-or-https-origin>` and optional `--manifest-path`, defaulting to `/data/v2/manifest.json`. It must:

1. Fetch manifest with `cache: 'no-store'` and validate schema/internal references.
2. Require manifest response cache policy to include `no-cache` or `no-store`.
3. Resolve every AssetRef relative to the fetched manifest URL.
4. Fetch every current word index, sector index, and root shard.
5. Verify status, decoded raw bytes, SHA-256, and immutable cache policy.
6. Parse every asset through the shared v2 validators.
7. Exit nonzero before any shell publication instruction when one check fails.

Do not upload, delete, or replace remote files from this verifier; deployment credentials and provider-specific mutation stay outside the repository.

Implement `scripts/verify-phase2-release.mjs` as a fail-closed verifier over `PHASE2_RELEASE_ARTIFACT_DIR` (or explicit `--artifacts <dir>`). Add `"verify:phase2-release": "node scripts/verify-phase2-release.mjs"`. It canonicalizes each signed report without its attestation, verifies its SHA-256 and Ed25519 signature against an allowlisted release public key, and writes a digest-only `phase2-release-verification.json` back to the release artifact directory. Phase 1's scored verifier evidence names its own immutable Phase 1 commit: require that commit to be an ancestor of the Phase 2 candidate and bind its verified artifact digest into the Phase 2 result. Require every Phase 2 unit/integration/browser/bundle/data, score-eligible D1/D2, `run-phase2-d3.mjs` Pixel 7a, rollback, and actual-origin report to name the exact same Phase 2 candidate commit. A Phase 1 artifact that claims the Phase 2 commit is invalid rather than desirable. Generated reports and verifier output remain release artifacts and are never staged.

- [ ] **Step 4: Document the exact assets-first publication order**

`docs/operations/catalog-v2-release.md` must prescribe:

1. Run all commands from Steps 6 and 7 below.
2. Upload every newly referenced hash-addressed asset while the old manifest remains live.
3. Run `verify-deployed-catalog.mjs` against a staging manifest that references those uploaded assets.
4. Replace `/data/v2/manifest.json` atomically only after every asset verifies from the actual origin.
5. Publish the sharded-default application shell only after the v2 manifest is live.
6. Retain hashes for at least two stable versions and at least 30 days, whichever is longer.
7. Never overwrite a hash-addressed URL and never remove a manifest-referenced asset.

Breaking schema must use `/data/v3/manifest.json`; it must not alter `/data/v2/` payload shape in place.

- [ ] **Step 5: Document and execute the rollback drill**

The rollback sequence is:

1. Preserve a non-empty `star-vocab-progress-v1` fixture in browser storage.
2. Restore the previous stable application tag and its manifest.
3. Verify every old hash still returns and passes bytes/SHA checks.
4. Verify previous LKG manifest starts the app when network manifest is blocked.
5. Verify the progress key is readable without migration and mastery values remain identical.
6. Restore the new candidate only through the same assets-first order.

Record the drill under the release artifact directory, not in tracked source. Do not remove the monolith branch during Phase 2.

- [ ] **Step 6: Run the complete automated release candidate matrix**

Run:

```bash
npm ci
npm run data:check
npm run test:unit
npm run test:integration
npm run test:browser
npm run perf:bundle
npm run perf:phase2 -- --project=D1 --project=D2
npm run perf:phase2:d3
VITE_DATA_MODE=monolith npm run build
VITE_DATA_MODE=sharded npm run build
git diff --check
```

Expected: all commands exit 0. Both build modes preserve `star-vocab-progress-v1`; sharded first-frame requests only manifest; monolith remains a working migration fallback.

- [ ] **Step 7: Verify the built artifact through the real static-server cache policy**

Start the benchmark server in one terminal:

```bash
node tests/helpers/static-server.mjs --root dist --port 4173
```

In a second terminal run:

```bash
node scripts/verify-deployed-catalog.mjs --origin http://127.0.0.1:4173
```

Expected: exit code 0 and a summary showing one manifest, one word index, every current sector index, and every current root shard verified by bytes and SHA-256 with correct cache policy. Stop the static server after verification.

Run `npm run verify:phase2-release` only after the rollback drill and actual-origin result have been added to the same signed release artifact set. Expected: exit code 0 and `phase2-release-verification.json` names the candidate commit and digests every accepted report. This exit-0 result, including real D3 evidence, is the sole Phase 2-to-Phase 3 authorization.

- [ ] **Step 8: Commit the release procedure and verifier**

Run:

```bash
git add package.json scripts/verify-deployed-catalog.mjs scripts/verify-phase2-release.mjs docs/operations/catalog-v2-release.md README.md scripts/README.md tests/integration/dataMode.test.ts tests/integration/deployedCatalogVerifier.test.ts tests/integration/phase2ReleaseVerifier.test.ts
git diff --cached --check
git commit -m "docs: define catalog v2 release and rollback"
```

Expected: one release-procedure commit. It contains no deployment secrets, generated reports, `.serena/`, or deletion of monolith assets.

- [ ] **Step 9: Perform the final tracked-file and commit-boundary audit**

Run:

```bash
git status --short
git log --oneline --decorate -12
git diff HEAD~12..HEAD --check
git diff HEAD~12..HEAD --name-only
```

Expected: only intentionally retained local state such as `.serena/` is untracked; all twelve Phase 2 commits are visible in order; diff check passes; the final file list contains only files named by this plan.

Phase 2 is independently releasable only after the automated matrix, D1/D2 reports, required real-Pixel D3 runner, rollback drill, and actual-origin asset verification all pass and `npm run verify:phase2-release` exits 0 over their signed release artifacts. Phase 3 work must not start to conceal a failed Phase 2 gate.
