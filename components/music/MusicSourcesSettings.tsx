import { useEffect, useState } from 'react'
import { Button, Input } from '@fluentui/react-components'

export function MusicSourcesSettings() {
  const [source, setSource] = useState('')
  const [online, setOnline] = useState(false)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  useEffect(() => {
    let mounted = true
    void window.music
      .lxInfo()
      .then((name) => {
        if (mounted) setSource(name)
      })
      .catch((error) => {
        if (mounted) setStatus(String(error))
      })
    return () => {
      mounted = false
      void window.music.lxCancel('import').catch(() => {})
    }
  }, [])
  async function importSource(url?: string) {
    if (busy) return
    setBusy(true)
    setStatus('')
    try {
      await window.music.lxImport(url)
      setSource(await window.music.lxInfo())
      setOnline(false)
      setLink('')
    } catch (error) {
      setStatus(String(error).split('Error: ').pop() || '操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <h2>音乐源</h2>
      <div className="settings-buttons">
        <span>{source || '尚未导入音乐源'}</span>
        <Button size="small" disabled={busy} onClick={() => void importSource()}>
          本地导入
        </Button>
        <Button
          size="small"
          disabled={busy}
          aria-expanded={online}
          onClick={() => setOnline(!online)}
        >
          在线导入
        </Button>
        {busy && (
          <Button
            size="small"
            onClick={() => void window.music.lxCancel('import').catch((e) => setStatus(String(e)))}
          >
            取消音源导入
          </Button>
        )}
      </div>
      {online && (
        <form
          className="settings-buttons"
          onSubmit={(e) => {
            e.preventDefault()
            void importSource(link.trim())
          }}
        >
          <Input
            aria-label="音乐源链接"
            value={link}
            placeholder="音乐源 JS 直链"
            onChange={(_, d) => setLink(d.value)}
          />
          <Button type="submit" disabled={!link.trim() || busy}>
            导入链接
          </Button>
        </form>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  )
}
