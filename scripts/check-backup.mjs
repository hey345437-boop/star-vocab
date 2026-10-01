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
  const snapshot = buildSnapshot(root, stage, { codexHome: path.join(temporary, 'empty-codex') })
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
