import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Word } from '../types'
import { useStore } from '../store/useStore'
import { createProgressBackup, MAX_PROGRESS_FILE_BYTES, parseProgressBackup } from '../lib/progressTransfer'

export default function ProgressTransfer({ words }: { words: Word[] }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const knownWordIds = useMemo(() => new Set(words.map((word) => word.id)), [words])
  const progress = useStore((state) => state.progress)
  const importProgress = useStore((state) => state.importProgress)

  function report(text: string, failed = false) {
    setMessage(text)
    setError(failed)
  }

  function exportFile() {
    try {
      const text = createProgressBackup(progress)
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `star-vocab-progress-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      report('已生成进度文件。请把下载的文件保存到自己的云盘，换机时再导入。')
    } catch {
      report('进度文件生成失败，请稍后重试。原有进度没有改变。', true)
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      if (file.size > MAX_PROGRESS_FILE_BYTES) throw new Error('文件过大，请选择星词生成的进度文件。')
      const incoming = parseProgressBackup(await file.text(), knownWordIds)
      const count = importProgress(incoming, knownWordIds)
      report(`已导入 ${count} 个单词的记录。刷新或下次打开也会保留。`)
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : '文件读取失败，请重试。'
      report(`导入失败：${detail} 原有进度没有改变。`, true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="progress-transfer">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="progress-transfer-panel"
      >备份 / 导入</button>
      {open && (
        <section id="progress-transfer-panel" className="progress-transfer-panel" aria-label="学习进度备份">
          <h2>带走你的背词进度</h2>
          <p>进度保存在当前浏览器。换电脑前保存文件，在新电脑打开项目后导入。</p>
          <p>导入时，相同单词采用文件里的记录；其他单词的进度会保留。</p>
          <div className="progress-transfer-actions">
            <button type="button" onClick={exportFile} disabled={busy}>保存进度文件</button>
            <button type="button" onClick={() => input.current?.click()} disabled={busy || !words.length}>
              {busy ? '正在导入…' : '导入进度文件'}
            </button>
          </div>
          <input ref={input} type="file" accept=".json,application/json" onChange={importFile} hidden />
          {message && (
            <p className={`progress-transfer-message${error ? ' progress-transfer-error' : ''}`} role={error ? 'alert' : 'status'}>
              {message}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
