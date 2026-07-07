# 数据管线 · build-dataset.mjs

把"人工源"编译成 app 实际读的数据，并自动长出关系网。这样**扩词只需写最少的字段**，繁琐的 ID 校验、配色、关系连线交给脚本。

## 跑

```bash
npm run data          # 校验源 + 重建 wordlinks.json（自动关系）
npm run data:enrich   # 额外联网补音标（dictionaryapi.dev，免费无 key；国内可能要代理）
```

## 数据流

```
人工源（手 / LLM 编辑）                 自动产出（脚本生成，别手改）
─────────────────────                  ──────────────────────────
public/data/roots.json   ─┐
public/data/words.json   ─┼─► build-dataset.mjs ─► public/data/wordlinks.json
scripts/manual-links.json ┘                         (+ 回填 words.json 音标 / roots.json 配色)
```

- **roots.json** —— 词根（恒星）。新根加进来，`color` 可留空，脚本自动配色。
- **words.json** —— 单词（行星）。必填 `id, word, rootId, pos, def_zh, breakdown, example`；`phonetic` 可留空，`--fetch` 补。
- **manual-links.json** —— 不可机器推断的关系（**近义 / 造句** 以及任何你想钉死的连线）。首次运行会从现有 wordlinks.json 无损引导生成。

## 关系网怎么自动来

脚本在人工关系之上，再推断三类（去重合并）：

1. **同根词尾押韵词族** → `谐音`（construct/instruct、reduce/produce…）
2. **同根反义前缀对** → `反义`（import↔export、progress↔regress、promote↔demote…）
3. **跨根经典前缀家族** → `谐音`（tele- / micro- / bio- / auto-…）

近义、造句这类需要语义的，留在 `manual-links.json` 里人工维护。

## 扩到上千词怎么办（诚实版）

脚本能自动化的：ID 去重校验、词根配色、英文音标（联网）、整张关系图、产物校验。
**不能**自动化的：`def_zh`（中文释义）和 `breakdown`（词根拆解）—— 这是这个 app 的价值所在，得人工或喂 LLM 批量生成。

所以真要冲上千词：批量准备 `{word, rootId, def_zh, breakdown}` 的紧凑行（中文释义/拆解可让 LLM 按词根成批产），追加进 words.json → `npm run data:enrich` 自动补音标 + 建图。词根骨架（经典 ~100 个根）铺满后，长尾就是往里灌词。
