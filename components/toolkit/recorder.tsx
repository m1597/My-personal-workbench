import { createRoot } from 'react-dom/client'

import { FluentProvider, createDOMRenderer, RendererProvider } from '@fluentui/react-components'
import { fluentTheme } from '../../src/renderer/src/app/fluentTheme'
import { ShortcutRecorder } from '../../src/renderer/src/app/ShortcutRecorder'
const renderers = new WeakMap<Document, ReturnType<typeof createDOMRenderer>>()
const shadowStyles = new WeakMap<ShadowRoot, Document>()
function styleDocument(parent: Node) {
  if (!(parent instanceof ShadowRoot)) return document
  let target = shadowStyles.get(parent)
  if (!target) {
    // Both Griffel and Fluent append their style elements to the supplied document head.
    target = document.implementation.createHTMLDocument()
    Object.defineProperty(target, 'head', { value: parent })
    shadowStyles.set(parent, target)
  }
  return target
}
type Props = Parameters<typeof ShortcutRecorder>[0]
export function mountRecorder(node: HTMLElement, props: Props) {
  const root = createRoot(node)
  const target = styleDocument(node.getRootNode())
  const renderer = renderers.get(target) || createDOMRenderer(target)
  renderers.set(target, renderer)
  const render = (next: Props) =>
    root.render(
      <RendererProvider renderer={renderer} targetDocument={target}>
        <FluentProvider
          targetDocument={target}
          theme={fluentTheme()}
          style={{ background: 'transparent' }}
        >
          <ShortcutRecorder {...next} />
        </FluentProvider>
      </RendererProvider>,
    )
  render(props)
  return { render, dispose: () => root.unmount() }
}
