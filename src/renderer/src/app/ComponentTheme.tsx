import { applyMaterial, type Material } from './material'
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { FluentProvider } from '@fluentui/react-components'
import { fluentTheme } from './fluentTheme'
import '../styles/tokens.css'
import '../styles/componentTheme.css'

export function configureBackdrop() {
  if (new URLSearchParams(location.search).get('nativeBackdrop') === 'acrylic')
    document.documentElement.dataset.backdrop = 'acrylic'
}

export function ComponentTheme({
  surface,
  children,
  className = '',
}: {
  surface: 'workspace' | 'window' | 'embedded'
  children: ReactNode
  className?: string
}) {
  const [theme] = useState(fluentTheme)
  useLayoutEffect(() => {
    if (surface !== 'embedded') return
    let received = false
    const apply = (state: { mode: string; material?: Material }) => {
      if (state.mode === 'docked' && state.material) applyMaterial(state.material)
    }
    const bridge = window.musicWindow || window.sampleHost
    if (!bridge) return
    const unsubscribe = bridge.subscribe((state) => {
      received = true
      apply(state)
    })
    const initial = window.musicWindow
      ? window.musicWindow.status()
      : window.sampleHost.hello({ protocol: '0.1' })
    void initial
      .then((state) => {
        if (!received) apply(state)
      })
      .catch(() => {})
    return () => {
      received = true
      unsubscribe()
      for (const key of ['--material-opacity', '--material-frost', '--material-light'])
        document.documentElement.style.removeProperty(key)
    }
  }, [surface])
  return (
    <FluentProvider theme={theme} data-surface={surface} className={'component-theme ' + className}>
      {children}
    </FluentProvider>
  )
}
