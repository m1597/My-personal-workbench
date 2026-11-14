import { useRef, useState } from 'react'

type Search = {
  scope: string
  enabled: boolean
  query: string
  pending: boolean
  ids?: string[]
  error?: string
}

export function useLibrarySearch(scope: string) {
  const initial = { scope, enabled: false, query: '', pending: false }
  const [state, setState] = useState<Search>(initial)
  const revision = useRef(0)
  if (scope !== state.scope) setState(initial)
  const change = (patch: Partial<Search>) => {
    ++revision.current
    setState((s) => ({ ...s, pending: false, ids: undefined, error: undefined, ...patch }))
  }
  async function submit(collection: string) {
    if (!state.enabled || !state.query.trim() || state.pending) return
    const ticket = ++revision.current
    setState((s) => ({ ...s, pending: true, error: undefined }))
    try {
      const ids = await window.music.searchCollection(collection, state.query.trim())
      setState((s) =>
        ticket === revision.current && s.scope === scope && s.pending
          ? { ...s, ids, pending: false }
          : s,
      )
    } catch (e) {
      const message = String(e).split('Error: ').pop() || '搜索失败'
      setState((s) =>
        ticket === revision.current && s.scope === scope && s.pending
          ? { ...s, error: message, pending: false }
          : s,
      )
    }
  }
  return {
    ...state,
    toggle: () => change({ ...initial, enabled: !state.enabled }),
    edit: (query: string) => change({ query }),
    submit,
  }
}
