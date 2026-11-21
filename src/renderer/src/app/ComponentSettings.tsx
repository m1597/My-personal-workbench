import { useLayoutEffect, useRef, useState, type ReactNode, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import {
  createSettingsGear,
  createSettingsShell,
  type Shell,
} from '../../../../components/toolkit/settings-shell.js'

export function SettingsGear({ label, onClick }: { label: string; onClick: () => void }) {
  const host = useRef<HTMLSpanElement>(null)
  const action = useRef(onClick)
  useLayoutEffect(() => {
    action.current = onClick
  }, [onClick])
  useLayoutEffect(() => {
    const gear = createSettingsGear({ label, onClick: () => action.current() })
    host.current?.replaceChildren(gear)
    return () => gear.remove()
  }, [label])
  return <span ref={host} style={{ display: 'contents' }} />
}
type Props<T extends string> = {
  title: string
  categories: ReadonlyArray<{ id: T; name: string; icon?: ComponentType<{ size?: number }> }>
  active: T
  onSelect: (id: T) => void
  onBack: () => void
  children: ReactNode
}
export function SettingsShell<T extends string>(props: Props<T>) {
  const host = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  const [shell, setShell] = useState<Shell>()
  useLayoutEffect(() => {
    latest.current = props
  })
  const signature = JSON.stringify([
    props.title,
    props.categories.map(({ id, name }) => [id, name]),
  ])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Rebuild the DOM only when navigation labels or keys change.
  useLayoutEffect(() => {
    const view = createSettingsShell({
      ...latest.current,
      onSelect: (id: T) => latest.current.onSelect(id),
      onBack: () => latest.current.onBack(),
    })
    host.current?.replaceChildren(view.element)
    setShell(view)
    return () => view.element.remove()
  }, [signature])
  useLayoutEffect(() => {
    shell?.select(props.active)
  }, [shell, props.active])
  return (
    <div ref={host} style={{ height: '100%', minHeight: 0, minWidth: 0 }}>
      {shell && (
        <>
          {createPortal(props.children, shell.content)}
          {props.categories.map(({ id, icon: Icon }) => {
            const target = shell.icons.get(id)
            return Icon && target ? createPortal(<Icon size={16} />, target, id) : null
          })}
        </>
      )}
    </div>
  )
}
