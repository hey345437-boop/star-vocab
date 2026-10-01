#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function safeRelativePath(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative)) {
    throw new Error('备份中发现不安全的文件路径。')
  }
  const parts = relative.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part === '.git')) {
    throw new Error('备份中发现不安全的文件路径。')
  }
  return relative
}

export function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function listSnapshotFiles(directory, prefix = '') {
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    safeRelativePath(relative)
    if (entry.isSymbolicLink()) throw new Error(`备份中有未支持的文件链接：${relative}`)
    if (entry.isDirectory()) result.push(...listSnapshotFiles(path.join(directory, entry.name), relative))
    else if (entry.isFile()) result.push(relative)
    else throw new Error(`备份中有未支持的文件：${relative}`)
  }
  return result.sort()
}

export function verifyBackup(directory) {
  const root = fs.realpathSync(directory)
  const manifestPath = path.join(root, 'manifest.json')
  if (fs.lstatSync(manifestPath).isSymbolicLink()) throw new Error('备份清单不能是文件链接。')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.format !== 'star-vocab-private-backup' || manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.fileCount !== manifest.files.length || !Number.isFinite(Date.parse(manifest.snapshotAt))) {
    throw new Error('备份清单格式不正确。')
  }
  const seen = new Set()
  for (const entry of manifest.files) {
    const relative = safeRelativePath(entry.path)
    if (relative === 'manifest.json' || seen.has(relative) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new Error(`备份清单中有错误记录：${relative}`)
    }
    seen.add(relative)
    const file = path.join(root, ...relative.split('/'))
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || fs.realpathSync(file) !== file || stat.size !== entry.bytes || fileHash(file) !== entry.sha256) {
      throw new Error(`备份文件不完整或已改动：${relative}`)
    }
  }
  const actual = listSnapshotFiles(root).filter((file) => file !== 'manifest.json')
  if (actual.length !== seen.size || actual.some((file) => !seen.has(file))) throw new Error('备份中有清单未记录的文件。')
  return { files: seen.size, snapshotAt: manifest.snapshotAt, manifest }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes('--help')) {
    console.log('用法：node scripts/verify-backup.mjs [备份 latest 文件夹]\n默认检查 .project-backups/private-repo/latest；逐个检查文件大小和内容。')
  } else {
    try {
      const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.project-backups/private-repo/latest')
      const result = verifyBackup(path.resolve(process.argv[2] || defaultRoot))
      console.log(`备份完整：${result.files} 个文件；保存时间 ${result.snapshotAt}。`)
    } catch (error) {
      console.error(`检查失败：${error.message}`)
      process.exitCode = 1
    }
  }
}
