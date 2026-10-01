# 星空背单词 · IELTS 词根

把雅思词汇按**词根**塞进一片 3D 星空：一个词根 = 一颗发光恒星，派生词 = 围着它的行星。背会的词，星会越来越亮。✨

灵感来自抖音「把 JLPT 日语单词塞进宇宙星空」，这里改成 **IELTS × 词根** 版。

## 跑起来

这是浏览器项目，Mac 和 Windows 使用同一份代码。准备 Git 和 Node.js，推荐使用 `.nvmrc` 指定的 **Node.js 24.21.0**，然后在终端运行下面的命令。Windows PowerShell 同样适用。

```text
git clone https://github.com/hey345437-boop/star-vocab.git
cd star-vocab
npm ci
npm run build
npm run dev
```

`npm ci` 按 `package-lock.json` 安装同一套依赖。打开 `npm run dev` 显示的网址即可使用；正式打包输出到 `dist/`，可用 `npm run preview` 检查。

换电脑之前请先看 [换机与备份说明](docs/MIGRATION.md)。要让新的制作聊天接着原来的工作做，先读 [项目制作进度](docs/PROJECT-STATUS.md)。

## 现在能干啥

- **72 个词根 × 6 个雅思词 = 432 词**，三维星系散布，全部带音标
- 真 3D：拖拽旋转宇宙、滚轮推进，发光球悬浮在不同深度 + 背景星海 + 彩色星云 + 暗角
- **闲置时星河缓慢自转**（电影级环绕，一操作就停）
- 点**恒星**飞入星系，该系词星**绕根星缓慢公转**（~22s 一圈，3D 倾斜轨道）
- 点**单词**弹词卡（读音 / 中英释义 / 词根拆解 / 例句，自动朗读）
- **关系链溯源点亮**：选中一个词，全场锁暗，近义 / 反义 / 造句 / 词族线依次亮起（235 条已校验关系）
- **可选光效**：保持原版默认开启，底部可以关闭以降低电脑负担
- 标记掌握度（没背 / 模糊 / 已掌握），星星亮度跟着变，进度存浏览器本地
- 导出、导入学习进度，换电脑时可以带走已背记录
- 左侧可搜索单词、释义和词根，筛选未掌握的词；选词、关系词跳转、下一词和快捷键可用
- **专注学习**：先回忆再看答案，回答“忘了 / 想起来了”，自动安排下一次复习；底部显示到期数量
- **省性能与故障保护**：专注模式无需运行星空，小屏默认使用；加载失败可重试，3D 中断可继续学习

## 还没做（后续阶段）

- 拼写测验与每日学习统计
- 继续扩词到全量雅思
- 账号与学习进度自动云同步

本轮修复点词、跳转和进度保护，补齐自测与到期复习。上一轮遗漏的镜头渲染回归也已单独修正，对照原画面恢复星空外观，详见 [修复与验证](docs/DEBUG-VERIFICATION.md)。三阶段性能架构仍有尚未实现和正式验收的部分，下一步见 [项目制作进度](docs/PROJECT-STATUS.md)。

制作时可运行 `npm test`、`npm run data:check`、`npm run learning:check`、`npm run build` 和 `npm run backup:check` 检查学习、内容、打包及恢复。Mac / Windows 自动检查执行同一套命令。

## 数据

- `public/data/roots.json` —— 词根（恒星）
- `public/data/words.json` —— 单词（行星）
- `public/data/wordlinks.json` —— 单词关系（**生成物，别手改**）

扩词工作流：往 `roots.json` / `words.json` 追加，不可推断的近义 / 反义写进 `scripts/manual-links.json`，然后：

```text
npm run data
npm run data:enrich
```

`npm run data` 校验并生成关系网；`npm run data:enrich` 额外联网补音标，使用 dictionaryapi.dev，无需密钥。词库修改后检查生成结果，再一起提交。

每条数据带 `source` 字段方便核查。

## 备份范围

GitHub 主仓库保存代码、完整词库、生成脚本、依赖版本、通用项目设置、设计和实施计划。原制作聊天与本机专用设置由项目所有者另存私有备份，公开仓库只保存能用于继续制作的 [交接摘要](docs/PROJECT-STATUS.md)。

`node_modules/`、`dist/` 和缓存不需要跨电脑复制，重新安装与打包即可生成。学习进度仍在当前浏览器中，**不会因推送代码而上传 GitHub**；先在底部“备份 / 导入”里保存进度文件，再连同项目备份。

准备 Git、Node.js 和已经登录的 GitHub CLI（`gh`），在项目目录运行：

```text
npm run backup -- --progress "导出文件路径"
npm run backup:verify
```

把“导出文件路径”换成实际 JSON 文件的位置。没有新进度文件时，可运行 `npm run backup` 备份项目、历史和已有附件；脚本创建或更新同一所有者下的 `<项目名>-private-backup`，强制要求私有。当前备份仓库为 [star-vocab-private-backup](https://github.com/hey345437-boop/star-vocab-private-backup)，本机副本在 `.project-backups/private-repo/latest/`。`npm run backup:verify` 检查文件齐全且内容一致，`npm run backup:check` 演练本地备份与恢复，不连接 GitHub。

每次停工更新制作进度、提交并推送代码、导出最新学习进度，再运行备份。**目前是手动备份，没有定时自动同步。** 旧聊天和附件会与新备份合并保留；没有新导出时沿用的旧进度标为 `carried-forward`，不代表已读取当前浏览器。详细恢复步骤见 [换机与备份说明](docs/MIGRATION.md)。

本轮在 Mac 上使用 Node.js 24.18.0、22.23.3、24.21.0 均已安装并打包成功。仓库还设置了 Mac / Windows 的自动检查；Windows 远程结果需查看对应提交的 Actions。3D 流畅度与读音取决于实际电脑、显卡和浏览器，需要在新机打开验证。

## 技术栈

Vite + React + TypeScript · react-force-graph-3d + three.js（3D 星图 + UnrealBloomPass 泛光）· Zustand（状态）· localStorage（进度）
