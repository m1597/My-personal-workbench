import { LxPanel } from './LxPanel'
import { useState } from 'react'
import { Button, Input } from '@fluentui/react-components'
import {
  FileMusic,
  FolderPlus,
  Music2,
  Play,
  Search,
  Trash2,
  AudioLines,
  FolderSearch,
} from 'lucide-react'
export type LocalTrack = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  available: number
}
export type ImportJob = {
  started?: boolean
  running: boolean
  added: number
  duplicates: number
  failed: number
  cancelled: boolean
}
export const formatTime = (t: number) =>
  Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0')
type Props = {
  refresh: () => Promise<void>
  rows: LocalTrack[]
  total: number
  search: string
  setSearch: (v: string) => void
  job?: ImportJob
  active: string
  playing: boolean
  play: (id: string) => void
  importFiles: (mode: 'folder' | 'files') => void
  cancel: () => void
  relocate: (id: string) => void
  remove: (id: string) => void
}
export function LibraryPane({
  refresh,
  rows,
  total,
  search,
  setSearch,
  job,
  active,
  playing,
  play,
  importFiles,
  cancel,
  relocate,
  remove,
}: Props) {
  const [limit, setLimit] = useState(100)
  const [online, setOnline] = useState<LocalTrack | null | undefined>()
  return (
    <section className="local-library" aria-label="本地歌曲库">
      <div className="library-title">
        <div>
          <h2>全部歌曲</h2>
          <small>{search ? rows.length + ' / ' + total : total} 首歌曲</small>
        </div>
        <div className="library-import">
          <Button size="small" onClick={() => setOnline(null)}>
            音乐源
          </Button>
          <Button
            size="small"
            icon={<FileMusic size={16} />}
            disabled={job?.running}
            onClick={() => importFiles('files')}
          >
            添加文件
          </Button>
          <Button
            size="small"
            appearance="primary"
            icon={<FolderPlus size={16} />}
            disabled={job?.running}
            onClick={() => importFiles('folder')}
          >
            添加文件夹
          </Button>
        </div>
      </div>
      {online !== undefined && (
        <LxPanel
          key={online?.id ?? 'source'}
          song={online}
          close={() => setOnline(undefined)}
          refresh={refresh}
        />
      )}
      <Input
        aria-label="搜索本地歌曲"
        type="search"
        placeholder="搜索歌名、艺人或专辑"
        contentBefore={<Search size={16} />}
        value={search}
        onChange={(_, v) => setSearch(v.value)}
      />
      {job?.started && (
        <div className="library-job" role="status">
          <span>
            {job.running ? '正在导入' : job.cancelled ? '导入已取消' : '导入完成'} · 新增{' '}
            {job.added} · 重复 {job.duplicates} · 失败 {job.failed}
          </span>
          {job.running && (
            <Button size="small" appearance="subtle" onClick={cancel}>
              取消导入
            </Button>
          )}
        </div>
      )}
      {rows.length ? (
        <>
          <div className="library-columns" aria-hidden="true">
            <span>歌曲 / 艺人</span>
            <span>专辑</span>
            <span>时长</span>
          </div>
          <ul>
            {rows.slice(0, limit).map((t) => (
              <li key={t.id} data-active={active === t.id} className="library-row">
                <Button
                  size="small"
                  appearance="subtle"
                  disabled={!t.available}
                  aria-label={'播放' + t.title}
                  icon={active === t.id && playing ? <AudioLines size={16} /> : <Play size={15} />}
                  onClick={() => play(t.id)}
                />
                <div className="library-name">
                  <strong title={t.title}>{t.title}</strong>
                  <small title={t.artist}>{t.artist}</small>
                  {!t.available && <small>文件不可用</small>}
                </div>
                <span className="library-album" title={t.album}>
                  {t.album || '—'}
                </span>
                <small className="library-time">{formatTime(t.duration)}</small>
                <Button
                  size="small"
                  appearance="subtle"
                  title="查找在线版本"
                  aria-label={'查找版本' + t.title}
                  icon={<Search size={15} />}
                  onClick={() => {
                    setOnline(t)
                    document.querySelector('.music-scroll')?.scrollTo(0, 0)
                  }}
                />
                {!t.available && (
                  <Button
                    size="small"
                    appearance="subtle"
                    title="重新定位"
                    aria-label={'重新定位' + t.title}
                    icon={<FolderSearch size={16} />}
                    onClick={() => relocate(t.id)}
                  />
                )}
                <Button
                  size="small"
                  appearance="subtle"
                  title="从曲库移除"
                  aria-label={'从曲库移除' + t.title}
                  icon={<Trash2 size={15} />}
                  onClick={() => remove(t.id)}
                />
              </li>
            ))}
          </ul>
          {rows.length > limit && (
            <Button onClick={() => setLimit((n) => n + 100)}>显示更多歌曲</Button>
          )}
        </>
      ) : (
        <div className="music-empty library-empty">
          <Music2 size={28} />
          <h2>{total ? '没有匹配的歌曲' : '曲库还是空的'}</h2>
          <p>
            {total ? '试试其他歌名、艺人或专辑。' : '选择音乐文件或文件夹，歌曲会保留在原位置。'}
          </p>
        </div>
      )}
    </section>
  )
}
