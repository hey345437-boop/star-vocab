# 换机与备份说明

项目在 Mac 和 Windows 上使用同一份代码，通过浏览器运行。能带走的内容分为三部分：项目文件、制作上下文、个人学习进度。它们的保存位置不同，换机时分别恢复。

## 什么已经在云端，什么需要单独带走

| 内容 | 保存位置 | 新机如何恢复 |
| --- | --- | --- |
| 程序代码、词库、生成脚本 | GitHub 主仓库 | `git clone` |
| 依赖版本、通用项目设置 | GitHub 主仓库 | `npm ci`，重新选择本机工具路径 |
| 架构设计、三阶段实施计划、交接摘要 | 主仓库 `docs/` | 让新的制作聊天读取这些文件 |
| 原制作聊天与本机专用设置 | 项目所有者的私有备份仓库 | 用有权限的 GitHub 账号下载，必要时读取历史副本 |
| 当前浏览器里的已背记录 | 浏览器本地；导出后可放私有备份 | 先导出 JSON，再用 `--progress` 备份，新机导入 |
| `node_modules/`、`dist/`、缓存 | 可重新生成 | `npm ci` 和 `npm run build` |
| 未提交的新改动、下载目录里的进度文件 | 当前电脑 | 先检查并保存，GitHub 不会自动收到 |

公开仓库不要上传原聊天日志、个人学习进度、本机专用设置或密钥。本项目使用不需要密钥的公共词典接口；制作与运行本项目不需要 fal 密钥。

## 旧电脑：离开前的步骤

1. 更新 `docs/PROJECT-STATUS.md`，写清做到哪一步、验证结果和下一步。
2. 在项目目录执行 `git status --short --branch`，确认新增文档与代码都已保存。
3. 提交并推送需要带走的新改动。下面是正常后续维护的例子，把文件名换成实际修改的文件；先核对内容，避免把个人文件一起上传：

```text
git status --short --branch
git diff
git add README.md docs/PROJECT-STATUS.md
git commit -m "docs: update project notes and handoff"
git push
```

4. 确认 GitHub 页面能看到最新提交，并且“Actions”里的 Mac / Windows 打包检查通过。
5. 在一直使用的浏览器和网址打开应用，点击底部“备份 / 导入”，再点击“保存进度文件”，保存带日期的 JSON 文件。`localhost` 和 `127.0.0.1`、不同端口、不同浏览器分别保存进度，要从实际使用的位置导出。
6. 用下面的备份命令保存项目、制作历史、本机配置、附件和刚导出的进度，再验证备份。

项目代码有云端版本不代表以后每次编辑都会自动同步。换机前必须完成对应的推送，学习进度也需要再次导出。

## 一次命令更新私有备份

需要 Git、Node.js 和 GitHub CLI（`gh`），并且 `gh` 已登录有权限的 GitHub 账号。可用 `gh auth status` 检查；没有登录时先完成 `gh auth login`。

在项目目录逐行运行，把路径换成刚导出的进度 JSON：

```text
npm run backup -- --progress "导出文件路径"
npm run backup:verify
```

有空格的路径保留双引号，Mac 与 Windows PowerShell 都适用。没有新进度文件时运行 `npm run backup`。脚本读取主仓库 `origin` 的所有者与项目名，创建或更新同一所有者下的 `<项目名>-private-backup`；发现备份仓库公开时会拒绝继续，不会把聊天和私人配置上传公开仓库。

当前私有云端备份为 [star-vocab-private-backup](https://github.com/hey345437-boop/star-vocab-private-backup)。本机备份副本保存在 `.project-backups/private-repo/latest/`，不提交到主仓库。

| `latest/` 下的内容 | 用途 |
| --- | --- |
| `project/` | 代码、词库、设计、计划、通用配置和本机 `project.local.yml`；也保存尚未提交的可携带项目文件 |
| `project.bundle` | 全部本地 Git 分支及提交历史 |
| `codex-history/raw/*.jsonl.gz` | 相关原会话记录的压缩副本，明显密钥已遮盖 |
| `codex-history/transcripts/*.md`、`index.json` | 便于新聊天读取的用户与可见助手消息、历史目录 |
| `progress/` | 已实际导出的学习进度文件 |
| `attachments/` | 放入 `.project-backups/attachments/` 的需要带走的附件 |
| `manifest.json` | 保存时间、捕获状态以及每个文件的大小和内容指纹，用于核对完整性 |

以后备份会合并保留旧电脑已经备份的聊天和附件。每次备份的旧版本也保留在私有仓库的 Git 历史中。临时附件未放入备份目录或已经消失时，脚本无法凭聊天文字重新生成原图；需要带走的原文件请先放入 `.project-backups/attachments/`。

进度状态有三种：`captured` 表示备份了导出文件，应同时核对文件的 `exportedAt` 日期；`carried-forward` 表示沿用上次文件；`not-captured` 表示没有保存到进度文件。**脚本不会读取当前浏览器。** 在新机运行备份而没有重新导出，保留旧文件不能视为已经备份新机最新学习记录。也可把导出文件放入 `.project-backups/progress/`，让脚本收集；停工前仍需重新导出最新文件。

`npm run backup:verify` 默认检查本机的 `latest/`，核对文件缺失和内容变化；它不是远端下载检查。可以传入刚从云端下载的 `latest/` 路径：

```text
npm run backup:verify -- "下载备份的latest目录路径"
```

`npm run backup:check` 在临时目录生成、验证并恢复项目，检查文件内容相同且能拒绝损坏的备份。这个演练不连接 GitHub、不读取用户聊天，也不会代替真实上传。以上流程由用户手动执行，没有定时自动同步。

## 新电脑：恢复项目

安装 Git 与 `.nvmrc` 指定的 Node.js 版本；本次换机基线是 Node.js 24.21.0。Mac 终端和 Windows PowerShell 都可以逐行运行：

```text
git clone https://github.com/hey345437-boop/star-vocab.git
cd star-vocab
node --version
npm --version
npm ci
npm run build
npm run dev
```

打开终端显示的网址。`npm run build` 必须成功后再继续制作，打包结果在 `dist/`。想检查正式打包效果时，停止开发服务，再运行：

```text
npm run preview
```

默认 `main` 保存本次完整交接版本。原性能制作分支为 `codex/performance-architecture`，要在这个分支继续时运行：

```text
git switch codex/performance-architecture
git pull --ff-only
```

已有仓库时，在保存好本机改动后运行 `git pull --ff-only`，再执行 `npm ci` 和 `npm run build`；不要在有未保存改动时直接覆盖整个文件夹。

Windows 不需要把 Mac 的 `node_modules/` 搬过去。保持同一份锁定文件，让 `npm ci` 为当前系统安装适用的依赖。通用项目设置随代码恢复，本机专用工具路径需在新电脑重新选择。

## 新电脑：恢复私有备份中的全部项目文件

只恢复主仓库已推送内容时，上一节已够用。要补回私有历史、本机配置或尚未提交的项目文件，在**刚创建且尚未开始修改的项目目录**里，登录有权限的 `gh` 后运行：

```text
gh repo clone hey345437-boop/star-vocab-private-backup .project-backups/private-repo
npm run backup:verify
```

验证通过后，在项目目录运行下面的 Node.js 命令，将备份里的项目文件补回来；Mac 与 Windows PowerShell 都可执行：

```text
node --input-type=module -e "import fs from 'node:fs'; fs.cpSync('.project-backups/private-repo/latest/project', '.', { recursive: true });"
npm ci
npm run build
npm run dev
```

该步骤会覆盖同名项目文件，旧电脑的专用路径需要改成新机路径。不要在有新机未保存改动时执行。

要连全部本地分支历史一起恢复，可以另外从已验证的 bundle 建一个新目录：

```text
git clone .project-backups/private-repo/latest/project.bundle ../star-vocab-restored
node --input-type=module -e "import fs from 'node:fs'; fs.cpSync('.project-backups/private-repo/latest/project', '../star-vocab-restored', { recursive: true });"
cd ../star-vocab-restored
git remote set-url origin https://github.com/hey345437-boop/star-vocab.git
npm ci
npm run build
```

bundle 保留 Git 历史，`project/` 再补回快照里的文件，两者结合能恢复尚未提交的制作内容。新目录里的分支和工作状态用 `git branch --all`、`git status --short --branch` 检查。

## 新电脑：恢复学习进度

1. 从已验证的私有备份 `latest/progress/` 或自己的云盘找到旧电脑导出的进度 JSON，核对导出日期。
2. 在新电脑的应用中点击底部“备份 / 导入”，再点击“导入进度文件”，选择该文件。
3. 检查已掌握数量和几个已背单词，然后刷新页面，确认记录仍在。

导入先校验整个文件，通过后才合并。备份中出现的单词会覆盖新机该词的旧记录；备份里没有的词保留新机现有记录。导入前建议先导出新机当前记录，以便选错文件后恢复。

项目继续使用 `star-vocab-progress-v1` 保存学习进度，包含掌握度和已有的复习字段。导入只接受该导出功能生成的文件，文件大小上限为 5 MiB；词 ID、状态和已有复习字段都要校验，支持 Windows 换行以及文件开头的 BOM。词库不一致时先恢复与备份相同的项目版本。导入错误时保留当前记录并显示失败原因。

遇到旧浏览器里混入坏记录的情况，本次修复会保留合法旧记录，并在覆盖原内容前将原文另存到浏览器的 recovery 键中，避免直接清空所有已背记录。该恢复副本仍在旧浏览器中；需要换机的有效记录请导出文件。

每次更换网址、端口或浏览器后，要再次导入才能看见相同记录。没有旧机导出文件或浏览器备份，GitHub 代码无法还原曾经只存在该浏览器中的背词记录。项目目前没有账号或自动同步服务。

## 恢复制作聊天与上下文

原制作聊天不属于 GitHub 项目文件。只在新电脑登录同一个 Codex 账号，不能作为该本地聊天已恢复的证明。

仍能连接旧电脑时，按官方流程把新电脑设置为已连接的电脑，准备同一个项目仓库，再使用 **Hand off** 将原聊天和代码工作状态交给新电脑。操作后核对目标仓库与工作状态。[Codex 官方换机说明](https://learn.chatgpt.com/docs/remote-connections#hand-off-a-chat-between-hosts)

私有备份 `latest/codex-history/` 保存相关原聊天历史，公开主仓库不含原聊天内容。可让新聊天读取 `transcripts/` 和 `index.json` 接续制作；原记录压缩副本中明显密钥已遮盖。**这些副本不保证能直接导入 Codex 变回原来的侧栏聊天窗口。**

如果原聊天窗口无法恢复，可以直接在新项目中开聊天，并发送：

```text
先读取 README.md、docs/MIGRATION.md、docs/PROJECT-STATUS.md，
再读取 docs/superpowers/specs/ 与 docs/superpowers/plans/ 的设计和三份计划。
读取 docs/DEBUG-VERIFICATION.md，确认当前代码、提交和测试结果，
保留已完成的点词/进度/学习/场景修复，再核对三阶段计划中的待办。
普通修复不代表三阶段正式验收已经完成；不要跳过真实性能和发布门槛。
```

交接摘要用于继续制作；需要核对用户原话或更早细节时，再读私有历史副本。将本机工具设置恢复到新机之前，先修改其中不适用的路径，避免照搬旧电脑的位置。

## 换机完成的检查

- `git status --short --branch` 能确认当前分支与改动情况。
- `npm ci`、`npm run build` 成功，应用可打开。
- 星空能显示，拖动、缩放、搜索、词根切换、选词、关系线和发音可用。
- 已背记录导入成功，刷新后仍保存。
- 新的制作聊天能说清本轮已完成的可用性修复，以及三阶段正式性能改造尚待完成的部分。

本轮 Mac 本机已用 Node.js 24.18.0、22.23.3、24.21.0 安装并打包成功，也实际验证了进度导入、坏数据拒绝、刷新保留和导出内容一致。Mac / Windows 的远程矩阵检查请查看当前提交的 GitHub Actions；真实 3D 流畅度、发音声音与显卡兼容仍需在新电脑打开检查。桌面构建成功不能替代计划中的手机真机性能验证。
