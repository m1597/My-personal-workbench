import { useContext, useState } from 'react'
import { Input } from '@fluentui/react-components'
import { Search, ChevronRight, PanelsTopLeft, Circle } from 'lucide-react'
import { WorkspaceContext } from '../app/WorkspaceContext'
import { modules, icons } from '../app/moduleRegistry'
import { openModule } from '../app/workspace'
export function NavigationPanel() {
  const workspace = useContext(WorkspaceContext)
  const [query, setQuery] = useState('')
  return (
    <section className="module-navigation" aria-label="模块 1 内容" data-testid="module-1">
      <div className="section-heading">
        <span>工作区模块</span>
        <span className="count">4</span>
      </div>
      <Input
        className="workbench-search"
        contentBefore={<Search size={16} />}
        aria-label="搜索模块"
        placeholder="搜索模块…"
        value={query}
        onChange={(_, data) => setQuery(data.value)}
      />
      <div className="module-list">
        {modules
          .filter((item) => item.title.replaceAll(' ', '').includes(query.replaceAll(' ', '')))
          .map((item) => {
            const Icon = icons[modules.indexOf(item)]
            const visible = workspace.visible.includes(item.id)
            return (
              <button
                type="button"
                key={item.id}
                className={`module-row ${workspace.active === item.id ? 'selected' : ''}`}
                onClick={() => workspace.api && openModule(workspace.api, item.id)}
                aria-label={`打开${item.title}`}
              >
                <ChevronRight size={12} />
                <Icon size={16} />
                <span>{item.title}</span>
                <span
                  className={`visibility-dot ${visible ? 'on' : ''}`}
                  title={visible ? '已打开' : '已关闭'}
                />
              </button>
            )
          })}
        {query &&
          !modules.some((item) =>
            item.title.replaceAll(' ', '').includes(query.replaceAll(' ', '')),
          ) && <p className="search-empty">没有匹配的模块</p>}
      </div>
      <div className="sidebar-note">
        <PanelsTopLeft size={17} />
        <strong>你的工作区，自由组合</strong>
        <p>
          拖动面板标签重新排列。
          <br />
          将模块放到顺手的位置。
        </p>
      </div>
      <div className="panel-footnote">
        <Circle size={7} fill="currentColor" /> 基础工作区
      </div>
    </section>
  )
}
