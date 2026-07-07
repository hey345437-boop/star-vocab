# 星空背单词 · IELTS 词根

把雅思词汇按**词根**塞进一片 3D 星空：一个词根 = 一颗发光恒星，派生词 = 围着它的行星。背会的词，星会越来越亮。✨

灵感来自抖音「把 JLPT 日语单词塞进宇宙星空」，这里改成 **IELTS × 词根** 版。

## 跑起来

```bash
npm install          # 国内可加 --registry=https://registry.npmmirror.com
npm run dev          # 本地开发，打开终端给的 http://localhost:xxxx
npm run build        # 打包到 dist/（可直接丢 GitHub Pages / Vercel）
```

## 现在能干啥

- **72 个词根 × 6 个雅思词 = 432 词**，三维星系散布，全部带音标
- 真 3D：拖拽旋转宇宙、滚轮推进，发光球悬浮在不同深度 + 背景星海 + 彩色星云 + 流星 + 暗角
- **闲置时星河缓慢自转**（电影级环绕，一操作就停）
- 点**恒星**飞入星系，该系词星**绕根星缓慢公转**（~22s 一圈，3D 倾斜轨道）
- 点**单词**弹词卡（读音 / 中英释义 / 词根拆解 / 例句，自动朗读）
- **关系链溯源点亮**：选中一个词，全场锁暗，它的近义 / 反义 / 造句 / 谐音线**依次亮起**（251 条关系）
- **真·泛光 Bloom 后处理**：整片星河一层朦胧光雾（底部按钮可开关）
- 标记掌握度（没背 / 模糊 / 已掌握），星星亮度跟着变，进度存浏览器本地
- 左侧可搜索单词列表（按词根分组）+「只看没背」筛选 + 🎲 随机背一个

## 还没做（后续阶段）

- 测验 / 自测
- 间隔重复（SRS，到期提醒复习）
- 继续扩词到全量雅思

## 数据

- `public/data/roots.json` —— 词根（恒星）
- `public/data/words.json` —— 单词（行星）
- `public/data/wordlinks.json` —— 单词关系（**生成物，别手改**）

扩词工作流：往 `roots.json` / `words.json` 追加，不可推断的近义 / 反义写进 `scripts/manual-links.json`，然后：

```bash
npm run data          # 校验 + 自动推断关系网（词族押韵 / 反义前缀对 / 前缀家族）
npm run data:enrich   # 额外联网补音标（dictionaryapi.dev，免费无 key）
```

每条数据带 `source` 字段方便核查。

## 技术栈

Vite + React + TypeScript · react-force-graph-3d + three.js（3D 星图 + UnrealBloomPass 泛光）· Zustand（状态）· localStorage（进度）
