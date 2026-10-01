import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { buildSnapshot } from './backup-project.mjs'
import { verifyBackup } from './verify-backup.mjs'

// Exercise a real local snapshot and restore on each CI operating system.
// This check never calls GitHub or reads the user's Codex history.
const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'star-vocab-backup-check-'))
try {
  const stage = path.join(temporary, 'snapshot')
  const codexHome = path.join(temporary, 'test-codex')
  const sessions = path.join(codexHome, 'sessions')
  fs.mkdirSync(sessions, { recursive: true })
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', windowsHide: true })
  if (origin.error || origin.status !== 0) throw new Error('Cannot read the project repository.')
  fs.writeFileSync(path.join(sessions, 'same-project-old-computer.jsonl'), JSON.stringify({
    type: 'session_meta', payload: { id: 'restore-check-session', cwd: path.join(temporary, 'old-computer-project'), git: { repository_url: origin.stdout.trim() } },
  }) + '\n')
  fs.writeFileSync(path.join(sessions, 'other-project.jsonl'), JSON.stringify({
    type: 'session_meta', payload: { id: 'other-project-session', cwd: path.join(temporary, 'different-project'), git: { repository_url: 'https://github.com/example/other-project.git' } },
  }) + '\n')
  const snapshot = buildSnapshot(root, stage, { codexHome })
  if (snapshot.manifest.history.count !== 1) throw new Error('Old-computer project history was lost, or unrelated history was included.')
  const verified = verifyBackup(stage)
  const restored = path.join(temporary, 'restored-project')
  const clone = spawnSync('git', ['clone', '--quiet', path.join(stage, 'project.bundle'), restored], { encoding: 'utf8', windowsHide: true })
  if (clone.error || clone.status !== 0) throw new Error(`Git history restore failed: ${clone.stderr || clone.error?.message}`)
  fs.cpSync(path.join(stage, 'project'), restored, { recursive: true })
  for (const entry of snapshot.manifest.files.filter((entry) => entry.path.startsWith('project/'))) {
    const source = path.join(stage, ...entry.path.split('/'))
    const destination = path.join(restored, ...entry.path.slice('project/'.length).split('/'))
    if (!fs.readFileSync(source).equals(fs.readFileSync(destination))) throw new Error(`Restored file differs: ${entry.path}`)
  }
  const privateIndex = path.join(temporary, 'private-index')
  fs.mkdirSync(privateIndex)
  fs.cpSync(stage, path.join(privateIndex, 'latest'), { recursive: true })
  for (const args of [['init', '--quiet'], ['add', '--force', '--all', '--', 'latest']]) {
    const result = spawnSync('git', args, { cwd: privateIndex, encoding: 'utf8', windowsHide: true })
    if (result.error || result.status !== 0) throw new Error(`Cannot stage backup files: ${result.stderr || result.error?.message}`)
  }
  const tracked = new Set(spawnSync('git', ['ls-files', '-z'], { cwd: privateIndex, encoding: 'utf8', windowsHide: true }).stdout.split('\0'))
  for (const entry of [...snapshot.manifest.files, { path: 'manifest.json' }]) {
    if (!tracked.has(`latest/${entry.path}`)) throw new Error(`Ignored snapshot file would not be uploaded: ${entry.path}`)
  }
  const firstFile = snapshot.manifest.files.find((entry) => entry.path.startsWith('project/'))
  const altered = path.join(stage, ...firstFile.path.split('/'))
  fs.appendFileSync(altered, '\nbackup corruption check\n')
  let rejected = false
  try { verifyBackup(stage) } catch { rejected = true }
  if (!rejected) throw new Error('A modified backup was incorrectly accepted.')
  console.log(`Local backup and restore passed: ${verified.files} files; modified backups rejected.`)
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
