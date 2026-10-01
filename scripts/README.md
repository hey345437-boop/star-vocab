# 词库生成与检查

`public/data/roots.json` 和 `words.json` 是学习内容源，`scripts/manual-links.json` 保存人工确认的关系。`wordlinks.json` 是生成物，不直接修改。

```text
npm run data
npm run data:check
npm run learning:check
```

词根需要 ID、名称、中文与英文含义、来源和颜色；生成时可为缺失颜色补配色。单词需要原始 ID、词根 ID、拼写、词性、中英释义、拆解、例句和音标。运行 `npm run data:enrich` 可以用公开词典接口补音标，不使用 fal 密钥；发布前应通过严格词库检查。

同义、反义和辨析例句必须写入 `manual-links.json` 并检查含义。自动连线只使用同根词尾或经典前缀作为词形助记，显示为“词族”；相同拼写部分不能自动证明押韵、近义或反义。

新增词时保留已有单词 ID，以免学习记录失联。补齐内容后生成并检查，词库与生成物一起提交。生成器会拒绝重复词/词根、空词根、悬空关系、坏字段和未知关系类型。

`data:check` 检查真实词库、生成物一致性和错误语义回归；`learning:check` 在隔离目录检查学习排程、进度保护、保存失败和导入兼容。它们不读取日常浏览器的个人进度。
