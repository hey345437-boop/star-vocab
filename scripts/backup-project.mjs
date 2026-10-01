#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fileHash, listSnapshotFiles, safeRelativePath, verifyBackup } from './verify-backup.mjs'

const MAX_FILE_BYTES = 95 * 1024 * 1024
const secretPatterns = [
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9_-]{16,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)/g,
]

export function redactSecrets(text) {
  let count = 0
  for (const pattern of secretPatterns) {
    text = text.replace(pattern, () => { count += 1; return '[REDACTED_SECRET]' })
  }
  return { text, count }
}

export function parseGitHubRemote(remote) {
  let match = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote.trim())
  if (!match) {
    let url
    try { url = new URL(remote) } catch { throw new Error('origin 必须指向 GitHub 仓库。') }
    if (url.hostname !== 'github.com' || (url.username && !(url.protocol === 'ssh:' && url.username === 'git')) || url.password || !['https:', 'ssh:'].includes(url.protocol)) {
      throw new Error('origin 必须指向 GitHub，且不能在地址中包含登录密钥。')
    }
    match = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.pathname)
  }
  if (!match || !/^[\w.-]+$/.test(match[1]) || !/^[\w.-]+$/.test(match[2])) throw new Error('无法读取 GitHub 仓库名称。')
  return { owner: match[1], project: match[2], fullName: `${match[1]}/${match[2]}` }
}

function command(binary, args, cwd, options = {}) {
  const result = spawnSync(binary, args, { cwd, encoding: options.binary ? null : 'utf8', input: options.input, maxBuffer: 128 * 1024 * 1024, windowsHide: true })
  if (result.error || result.status !== 0) {
    const detail = redactSecrets(String(result.stderr || result.error?.message || '')).text.trim()
    const error = new Error(`${binary} ${args[0] || ''} 执行失败。${detail ? ` ${detail.slice(0, 1000)}` : ''}`)
    error.commandStderr = detail
    throw error
  }
  return result.stdout
}

function writeFile(root, relative, bytes) {
  safeRelativePath(relative)
  const target = path.join(root, ...relative.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, bytes)
  return target
}

export function excludeProjectPath(relative) {
  const parts = relative.split('/')
  if (parts.some((part) => ['.git', 'node_modules', 'dist', '.project-backups', '.cache', 'cache', '.vite'].includes(part))) return true
  const name = parts.at(-1)
  if (name === '.DS_Store' || /\.tsbuildinfo$/.test(name)) return true
  if (/^\.env(?:\..*)?$/.test(name) && !/\.(?:example|sample|template)$/.test(name)) return true
  return /^(?:\.npmrc|\.netrc|credentials(?:\..*)?|auth\.json|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?|.*\.(?:pem|key|p12|pfx))$/i.test(name)
}

function copyProject(root, stage) {
  const listed = command('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root).split('\0').filter(Boolean)
  if (fs.existsSync(path.join(root, '.serena/project.local.yml'))) listed.push('.serena/project.local.yml')
  const excluded = []
  let count = 0
  for (const relative of [...new Set(listed)].sort()) {
    safeRelativePath(relative)
    if (excludeProjectPath(relative)) { excluded.push(relative); continue }
    const source = path.join(root, ...relative.split('/'))
    if (!fs.existsSync(source)) { excluded.push(relative); continue }
    const stat = fs.lstatSync(source)
    if (!stat.isFile() || fs.realpathSync(source) !== source) throw new Error(`文件链接或子项目需单独处理，暂不上传：${relative}`)
    if (stat.size > MAX_FILE_BYTES) throw new Error(`文件过大，暂不上传：${relative}`)
    const bytes = fs.readFileSync(source)
    if (redactSecrets(bytes.toString('utf8')).count) throw new Error(`发现可能的登录密钥，停止上传：${relative}`)
    const destination = writeFile(stage, `project/${relative}`, bytes)
    fs.chmodSync(destination, stat.mode & 0o777)
    count += 1
  }
  return { count, excluded }
}

function checkGitHistory(root) {
  const objects = command('git', ['rev-list', '--objects', '--all'], root).split('\n').filter(Boolean)
  const names = new Map(objects.map((line) => { const split = line.indexOf(' '); return split < 0 ? [line, '(历史记录)'] : [line.slice(0, split), line.slice(split + 1)] }))
  const ids = [...names.keys()]
  if (!ids.length) throw new Error('项目需要至少一个 Git 提交，才能保存完整历史。')
  const info = command('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], root, { input: `${ids.join('\n')}\n` })
  for (const line of info.trim().split('\n')) {
    const [id, kind, size] = line.split(' ')
    if (kind !== 'blob' && kind !== 'commit' && kind !== 'tag') continue
    if (Number(size) > MAX_FILE_BYTES) throw new Error(`历史文件过大，需单独处理：${names.get(id)}`)
    const bytes = command('git', ['cat-file', kind, id], root, { binary: true })
    if (redactSecrets(bytes.toString('utf8')).count) throw new Error(`Git 历史中发现可能的登录密钥，停止上传：${names.get(id)}`)
  }
}

function collectJsonlFiles(directory) {
  if (!fs.existsSync(directory)) return []
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectJsonlFiles(file))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(file)
  }
  return files.sort()
}

function firstSessionMeta(file) {
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.alloc(64 * 1024)
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let readBytes = 0
  try {
    while (readBytes < 16 * 1024 * 1024) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (!read) break
      readBytes += read
      pending += decoder.write(buffer.subarray(0, read))
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        try { const item = JSON.parse(line); if (item.type === 'session_meta') return item.payload } catch { /* 不完整或损坏的记录不用于匹配。 */ }
      }
    }
    pending += decoder.end()
    try { const item = JSON.parse(pending); if (item.type === 'session_meta') return item.payload } catch { /* 尾行尚未写完。 */ }
    return null
  } finally { fs.closeSync(descriptor) }
}

export function parseSession(text) {
  const records = []
  let meta = null
  let skippedLines = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.type !== 'string') { skippedLines += 1; continue }
      if (!meta && record.type === 'session_meta') meta = record.payload
      records.push(record)
    } catch { skippedLines += 1 }
  }
  return { meta, records, skippedLines }
}

export function readableTranscript(records) {
  const messages = []
  for (const record of records) {
    if (record.type !== 'response_item' || record.payload?.type !== 'message') continue
    const message = record.payload
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (message.role === 'assistant' && ((message.channel && !['final', 'final_answer', 'commentary'].includes(message.channel)) || (message.phase && !['final', 'final_answer', 'commentary'].includes(message.phase)))) continue
    const content = (Array.isArray(message.content) ? message.content : []).map((part) => {
      if (['input_text', 'output_text', 'text'].includes(part.type) && typeof part.text === 'string') return part.text
      if (['input_image', 'image'].includes(part.type)) return '[对话中的图片附件；请另行保留原图。]'
      return ''
    }).filter(Boolean).join('\n\n')
    if (content.trim()) messages.push(`### ${message.role === 'user' ? '用户' : '助手'}${record.timestamp ? ` · ${record.timestamp}` : ''}\n\n${content}`)
  }
  return messages.join('\n\n')
}

function copyHistory(root, stage, codexHome) {
  const index = []
  const seenIds = new Set()
  let redactions = 0
  let skippedLines = 0
  for (const folder of ['sessions', 'archived_sessions']) {
    for (const source of collectJsonlFiles(path.join(codexHome, folder))) {
      const meta = firstSessionMeta(source)
      if (typeof meta?.cwd !== 'string') continue
      let sessionRoot
      try { sessionRoot = fs.realpathSync(meta.cwd) } catch { sessionRoot = path.resolve(meta.cwd) }
      if (sessionRoot !== root) continue
      const original = fs.readFileSync(source, 'utf8')
      const initial = parseSession(original)
      const redacted = redactSecrets(original)
      const session = parseSession(redacted.text)
      const id = String(session.meta?.id || session.meta?.session_id || path.basename(source, '.jsonl'))
      if (seenIds.has(id)) continue
      seenIds.add(id)
      const name = crypto.createHash('sha256').update(path.relative(codexHome, source)).digest('hex').slice(0, 16)
      const relative = `codex-history/raw/${name}.jsonl.gz`
      writeFile(stage, relative, zlib.gzipSync(redacted.text))
      const transcriptPath = `codex-history/transcripts/${name}.md`
      writeFile(stage, transcriptPath, `# 项目对话 ${id}\n\n${readableTranscript(session.records)}\n`)
      index.push({ id, path: relative, transcriptPath, source: path.relative(codexHome, source).split(path.sep).join('/'), timestamp: session.meta?.timestamp || null, redactions: redacted.count, skippedLines: initial.skippedLines })
      redactions += redacted.count
      skippedLines += initial.skippedLines
    }
  }
  writeHistoryIndex(stage, index)
  return { count: index.length, capturedSessions: index.length, carriedSessions: 0, redactions, skippedLines }
}

function writeHistoryIndex(stage, index) {
  index.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')) || a.id.localeCompare(b.id))
  writeFile(stage, 'codex-history/index.json', `${JSON.stringify(index, null, 2)}\n`)
  writeFile(stage, 'codex-history/transcript.md', '# 星词项目对话目录\n\n这些文件只保留用户和可见助手消息，便于换机后在新聊天中继续。完整原记录的压缩副本已遮盖明显密钥。\n\n' + index.map((item) => `- [${item.id}](transcripts/${path.basename(item.transcriptPath)}) · ${item.timestamp || '时间未知'}${item.carriedForward ? ' · 保留自上次备份' : ''}`).join('\n') + '\n')
}

function validateProgressBackup(bytes, knownWordIds) {
  const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
  if (value?.format !== 'star-vocab-progress' || value.version !== 1 || typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt)) || !value.progress || typeof value.progress !== 'object' || Array.isArray(value.progress)) throw new Error('学习进度文件格式不正确。请使用页面里的「保存进度文件」。')
  for (const [id, progress] of Object.entries(value.progress)) {
    if (!knownWordIds.has(id) || !progress || !['new', 'fuzzy', 'mastered'].includes(progress.status)) throw new Error('学习进度文件包含错误单词或状态。')
  }
  if (redactSecrets(bytes.toString('utf8')).count) throw new Error('学习进度文件中发现可能的密钥，停止上传。')
  return { entries: Object.keys(value.progress).length, exportedAt: value.exportedAt }
}

function copyProgress(root, stage, explicitPath) {
  const directory = path.join(root, '.project-backups/progress')
  const sources = explicitPath ? [path.resolve(explicitPath)] : fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => path.join(directory, entry.name)) : []
  const wordIds = new Set(JSON.parse(fs.readFileSync(path.join(root, 'public/data/words.json'), 'utf8')).map((word) => word.id))
  let entries = 0
  const exports = []
  for (const [index, source] of sources.sort().entries()) {
    const stat = fs.lstatSync(source)
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('学习进度文件过大或不是普通文件。')
    const bytes = fs.readFileSync(source)
    const details = validateProgressBackup(bytes, wordIds)
    const relative = `progress/${index + 1}-${path.basename(source)}`
    entries += details.entries
    exports.push({ path: relative, ...details })
    writeFile(stage, relative, bytes)
  }
  return { status: sources.length ? 'captured' : 'not-captured', files: sources.length, entries, exports }
}

function copyAttachments(root, stage) {
  const directory = path.join(root, '.project-backups/attachments')
  if (!fs.existsSync(directory)) return { capturedFiles: 0, carriedFiles: 0, files: 0 }
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('附件文件夹不能是文件链接。')
  const files = listSnapshotFiles(directory)
  for (const relative of files) {
    if (excludeProjectPath(relative)) throw new Error(`附件目录包含不能备份的文件：${relative}`)
    const bytes = fs.readFileSync(path.join(directory, ...relative.split('/')))
    if (bytes.length > MAX_FILE_BYTES || redactSecrets(bytes.toString('utf8')).count) throw new Error(`附件过大或包含可能的登录密钥：${relative}`)
    writeFile(stage, `attachments/${relative}`, bytes)
  }
  return { capturedFiles: files.length, carriedFiles: 0, files: files.length }
}

function refreshManifest(stage, manifest) {
  const files = listSnapshotFiles(stage).filter((relative) => relative !== 'manifest.json').map((relative) => {
    const source = path.join(stage, ...relative.split('/'))
    return { path: relative, bytes: fs.statSync(source).size, sha256: fileHash(source) }
  })
  if (files.some((file) => file.bytes > MAX_FILE_BYTES)) throw new Error('有备份文件超过 GitHub 单个文件的大小限制。')
  manifest.fileCount = files.length
  manifest.files = files
  writeFile(stage, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
  verifyBackup(stage)
}

export function mergePreviousSnapshot(stage, previous, snapshot) {
  if (!fs.existsSync(previous)) return
  if (fs.lstatSync(previous).isSymbolicLink()) throw new Error('上次备份文件夹不能是文件链接。')
  const prior = verifyBackup(previous).manifest
  if (prior.source?.repository?.toLowerCase() !== snapshot.origin.fullName.toLowerCase()) throw new Error('旧备份属于另一个项目，停止合并和上传。')
  const currentIndex = JSON.parse(fs.readFileSync(path.join(stage, 'codex-history/index.json'), 'utf8'))
  const previousIndex = JSON.parse(fs.readFileSync(path.join(previous, 'codex-history/index.json'), 'utf8'))
  const seenIds = new Set(currentIndex.map((item) => item.id))
  let carriedSessions = 0
  for (const item of previousIndex) {
    if (seenIds.has(item.id)) continue
    if (typeof item.id !== 'string' || !item.path?.startsWith('codex-history/raw/') || !item.path.endsWith('.jsonl.gz')) throw new Error('旧聊天目录格式不正确。')
    safeRelativePath(item.path)
    const original = zlib.gunzipSync(fs.readFileSync(path.join(previous, ...item.path.split('/')))).toString('utf8')
    const redacted = redactSecrets(original)
    const name = crypto.createHash('sha256').update(`carried:${item.id}`).digest('hex').slice(0, 16)
    const relative = `codex-history/raw/${name}.jsonl.gz`
    const transcriptPath = `codex-history/transcripts/${name}.md`
    writeFile(stage, relative, zlib.gzipSync(redacted.text))
    writeFile(stage, transcriptPath, `# 项目对话 ${item.id}\n\n${readableTranscript(parseSession(redacted.text).records)}\n`)
    currentIndex.push({ ...item, path: relative, transcriptPath, redactions: (item.redactions || 0) + redacted.count, carriedForward: true })
    snapshot.manifest.history.redactions += (item.redactions || 0) + redacted.count
    snapshot.manifest.history.skippedLines += item.skippedLines || 0
    seenIds.add(item.id)
    carriedSessions += 1
  }
  writeHistoryIndex(stage, currentIndex)
  snapshot.manifest.history.count = currentIndex.length
  snapshot.manifest.history.carriedSessions = carriedSessions
  if (snapshot.manifest.progress.files === 0) {
    const oldProgress = prior.files.filter((file) => file.path.startsWith('progress/'))
    const exports = []
    let entries = 0
    for (const file of oldProgress) {
      const bytes = fs.readFileSync(path.join(previous, ...file.path.split('/')))
      if (redactSecrets(bytes.toString('utf8')).count) throw new Error('旧学习进度中发现可能的密钥，停止上传。')
      const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
      if (value.format !== 'star-vocab-progress' || value.version !== 1 || !value.progress || Array.isArray(value.progress) || typeof value.progress !== 'object') throw new Error('旧学习进度文件格式不正确。')
      const count = Object.keys(value.progress).length
      exports.push({ path: file.path, exportedAt: value.exportedAt, entries: count })
      entries += count
      writeFile(stage, file.path, bytes)
    }
    if (oldProgress.length) snapshot.manifest.progress = { status: 'carried-forward', files: oldProgress.length, entries, exports, carriedFromSnapshotAt: prior.snapshotAt }
  }
  let carriedFiles = 0
  for (const file of prior.files.filter((item) => item.path.startsWith('attachments/'))) {
    if (fs.existsSync(path.join(stage, ...file.path.split('/')))) continue
    const bytes = fs.readFileSync(path.join(previous, ...file.path.split('/')))
    if (redactSecrets(bytes.toString('utf8')).count) throw new Error('旧附件中发现可能的登录密钥，停止上传。')
    writeFile(stage, file.path, bytes)
    carriedFiles += 1
  }
  snapshot.manifest.attachments.carriedFiles = carriedFiles
  snapshot.manifest.attachments.files += carriedFiles
  refreshManifest(stage, snapshot.manifest)
}

function privateReadme(target) {
  return `# 项目完整私有备份\n\n仓库：${target}。请一直保持私有。\n\nlatest/project/ 是当前代码、词库、文档和可安全携带的项目配置。latest/project.bundle 保存所有 Git 分支和提交；项目文件夹还包括尚未提交的内容。node_modules、dist、缓存和登录密钥不会上传，新电脑重新安装依赖。\n\nlatest/codex-history/ 保存与项目文件夹匹配的 Codex 对话，也保留上次备份里的旧电脑对话。transcripts/ 只有用户和可见助手消息，任意新聊天都可阅读后继续；raw/ 是遮盖明显密钥后的原记录压缩版。这些文件不能保证让 Codex 原聊天重新出现在侧栏。要保留原聊天界面和完整衔接，换机前使用 Codex 的 Hand off（转交）功能。图片附件需要另行保留原图，不能保证临时文件仍可读取。把需要带走的附件放入 .project-backups/attachments/，脚本会保存在 latest/attachments/，并保留旧电脑已备份的附件。\n\nlatest/progress/ 保存已导出的学习进度。manifest.json 的 progress.status 为 not-captured 时，说明尚未备份浏览器进度；carried-forward 表示保留上次文件，可能早于当前浏览器。exports 列出各文件的原导出时间。先在项目页面点击「备份 / 导入」→「保存进度文件」，再执行备份脚本并传入 --progress 文件路径，或把文件放进 .project-backups/progress/。\n\n新电脑：先克隆原项目，再从这里的 latest/project/ 补回文件；执行 npm ci 和 npm run dev。把进度文件导入页面即可恢复学习记录。需要查看历史时可运行 git clone latest/project.bundle restored-project。运行原项目 scripts/verify-backup.mjs 并传入 latest 文件夹，可以检查文件是否齐全。每次备份的旧版本保留在这个私有仓库的 Git 历史中。\n`
}

export function buildSnapshot(root, stage, options = {}) {
  root = fs.realpathSync(root)
  if (!fs.existsSync(stage)) fs.mkdirSync(stage, { recursive: true })
  if (fs.readdirSync(stage).length) throw new Error('临时备份文件夹必须为空，防止混入旧内容。')
  const origin = parseGitHubRemote(command('git', ['remote', 'get-url', 'origin'], root).trim())
  const project = copyProject(root, stage)
  checkGitHistory(root)
  command('git', ['bundle', 'create', path.join(stage, 'project.bundle'), '--all'], root)
  if (fs.statSync(path.join(stage, 'project.bundle')).size > MAX_FILE_BYTES) throw new Error('Git 历史备份文件过大，需另行保存。')
  const history = copyHistory(root, stage, options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'))
  const progress = copyProgress(root, stage, options.progressPath)
  const attachments = copyAttachments(root, stage)
  writeFile(stage, 'README.md', privateReadme(`${origin.owner}/${origin.project}-private-backup`))
  const files = listSnapshotFiles(stage).map((relative) => { const source = path.join(stage, ...relative.split('/')); return { path: relative, bytes: fs.statSync(source).size, sha256: fileHash(source) } })
  if (files.some((file) => file.bytes > MAX_FILE_BYTES)) throw new Error('有备份文件超过 GitHub 单个文件的大小限制。')
  const manifest = {
    format: 'star-vocab-private-backup', version: 1, snapshotAt: new Date().toISOString(),
    source: { repository: origin.fullName, projectPath: root, gitHead: command('git', ['rev-parse', 'HEAD'], root).trim(), gitStatus: command('git', ['status', '--porcelain=v1', '--untracked-files=all'], root).trim() },
    project, history, progress, attachments, fileCount: files.length, files,
  }
  writeFile(stage, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
  verifyBackup(stage)
  return { origin, manifest }
}

function getPrivateRepository(root, target, createMissing = false) {
  let repository
  try { repository = JSON.parse(command('gh', ['repo', 'view', target, '--json', 'isPrivate,url,defaultBranchRef,nameWithOwner'], root)) }
  catch (error) {
    if (!createMissing || !/Could not resolve to a Repository|HTTP 404|not found/i.test(error.commandStderr || '')) throw error
    command('gh', ['repo', 'create', target, '--private', '--description', 'Private project files and project chat backup'], root)
    repository = JSON.parse(command('gh', ['repo', 'view', target, '--json', 'isPrivate,url,defaultBranchRef,nameWithOwner'], root))
  }
  if (repository.isPrivate !== true || repository.nameWithOwner.toLowerCase() !== target.toLowerCase()) throw new Error('备份目标不是确认过的私有仓库，停止上传。')
  return repository
}

export function uploadSnapshot(root, stage, snapshot) {
  const target = `${snapshot.origin.owner}/${snapshot.origin.project}-private-backup`
  const remote = getPrivateRepository(root, target, true)
  const local = path.join(root, '.project-backups/private-repo')
  if (!fs.existsSync(local)) command('gh', ['repo', 'clone', target, local], root)
  if (fs.lstatSync(local).isSymbolicLink() || fs.realpathSync(local) !== local) throw new Error('私有备份文件夹不能是文件链接。')
  if (parseGitHubRemote(command('git', ['remote', 'get-url', 'origin'], local).trim()).fullName.toLowerCase() !== target.toLowerCase()) throw new Error('本机备份文件夹连接了不同仓库，停止上传。')
  if (command('git', ['status', '--porcelain'], local).trim()) throw new Error('本机私有备份文件夹有尚未保存的改动，请先处理后重试。')
  command('git', ['fetch', 'origin'], local)
  const branch = remote.defaultBranchRef?.name || command('git', ['symbolic-ref', '--short', 'HEAD'], local).trim()
  const remoteBranch = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd: local, windowsHide: true })
  if (remoteBranch.status === 0) {
    command('git', ['switch', branch], local)
    command('git', ['merge', '--ff-only', `origin/${branch}`], local)
  }
  const latest = path.join(local, 'latest')
  mergePreviousSnapshot(stage, latest, snapshot)
  fs.rmSync(latest, { recursive: true, force: true })
  fs.cpSync(stage, latest, { recursive: true })
  fs.writeFileSync(path.join(local, 'README.md'), privateReadme(target))
  verifyBackup(latest)
  command('git', ['add', '--all', '--', 'latest', 'README.md'], local)
  const authorName = spawnSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout?.trim() || 'Project backup'
  const authorEmail = spawnSync('git', ['config', 'user.email'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout?.trim() || `${snapshot.origin.owner}@users.noreply.github.com`
  command('git', ['-c', `user.name=${authorName}`, '-c', `user.email=${authorEmail}`, 'commit', '-m', `Project backup ${snapshot.manifest.snapshotAt}`], local)
  getPrivateRepository(root, target)
  command('git', ['push', '-u', 'origin', `HEAD:${branch}`], local)
  const head = command('git', ['rev-parse', 'HEAD'], local).trim()
  const published = command('git', ['ls-remote', 'origin', `refs/heads/${branch}`], local).trim().split(/\s/)[0]
  if (head !== published) throw new Error('远端提交与本机不一致，备份尚未确认。')
  return { url: remote.url, head }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('用法：node scripts/backup-project.mjs [--progress 进度文件.json]\n把当前项目和相关对话完整备份到同一 GitHub 账号的项目名-private-backup 私有仓库。\n需要 Node.js 22/24、Git、已登录的 GitHub CLI。\n先在网页保存学习进度，使用 --progress 指定文件，或放入 .project-backups/progress/。\n不备份全局登录密钥或其他项目。不会自动恢复 Codex 原聊天界面。')
    return
  }
  if (args.length && !(args.length === 2 && args[0] === '--progress')) throw new Error('参数不正确，请执行 --help。')
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const root = fs.realpathSync(command('git', ['rev-parse', '--show-toplevel'], scriptRoot).trim())
  const backupRoot = path.join(root, '.project-backups')
  fs.mkdirSync(backupRoot, { recursive: true })
  if (fs.lstatSync(backupRoot).isSymbolicLink()) throw new Error('备份文件夹不能是文件链接。')
  const stage = fs.mkdtempSync(path.join(backupRoot, 'staging-'))
  try {
    console.log('正在收集项目文件、历史和本项目对话。')
    const snapshot = buildSnapshot(root, stage, { progressPath: args[1] })
    console.log(`检查完成：${snapshot.manifest.project.count} 个项目文件，${snapshot.manifest.history.count} 个对话，遮盖 ${snapshot.manifest.history.redactions} 处明显密钥。`)
    const result = uploadSnapshot(root, stage, snapshot)
    console.log(`私有云端备份已核对：${result.url}`)
    const progressStatus = snapshot.manifest.progress.status
    console.log(`学习进度：${progressStatus === 'captured' ? `已保存 ${snapshot.manifest.progress.files} 个导出文件，共 ${snapshot.manifest.progress.entries} 条记录` : progressStatus === 'carried-forward' ? '保留上次导出文件，未读取当前浏览器' : '尚未导出，因此未保存'}。`)
  } finally { fs.rmSync(stage, { recursive: true, force: true }) }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(`备份失败：${redactSecrets(error.message).text}`); process.exitCode = 1 })
}
