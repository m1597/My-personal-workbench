import { useState, type ReactNode } from 'react'
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
  return (
    <FluentProvider theme={theme} data-surface={surface} className={'component-theme ' + className}>
      {children}
    </FluentProvider>
  )
}
