import { Tab, TabList } from '@fluentui/react-components'
import { useEffect, useState, type ReactNode } from 'react'

export function DiscoveryNavigation({
  ai,
  publicMode,
  selectAI,
  selectLists,
}: {
  ai: boolean
  publicMode: boolean
  selectAI(value: boolean): void
  selectLists(value: boolean): void
}) {
  return (
    <>
      <TabList
        className="discovery-sidebar"
        aria-label="找歌方式"
        vertical
        selectedValue={ai ? 'ai' : 'search'}
        onTabSelect={(_, data) => selectAI(data.value === 'ai')}
      >
        <Tab value="search">普通搜索</Tab>
        <Tab value="ai" data-guide-anchor="ai-entry">
          AI 推荐
        </Tab>
      </TabList>
      <TabList
        className="discovery-kinds"
        aria-label="查找内容"
        selectedValue={publicMode ? 'lists' : 'songs'}
        onTabSelect={(_, data) => selectLists(data.value === 'lists')}
      >
        <Tab value="songs">歌曲</Tab>
        <Tab value="lists">公开歌单</Tab>
      </TabList>
    </>
  )
}

export function DiscoveryView({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(false)
  useEffect(() => {
    if (active) setVisited(true)
  }, [active])
  if (!active && !visited) return null
  return (
    <div className="discovery-view" hidden={!active}>
      {children}
    </div>
  )
}
