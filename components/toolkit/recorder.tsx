import { createElement, type ComponentType } from 'react'
import popupStyles from '../../src/renderer/src/styles/componentTheme.css?inline'
import { ChoiceDropdown } from '../../src/renderer/src/app/SharedDropdown'
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
function mountControl<Props extends object>(
  node: HTMLElement,
  Control: ComponentType<Props>,
  props: Props,
) {
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
          {createElement(Control, next)}
        </FluentProvider>
      </RendererProvider>,
    )
  render(props)
  return { render, dispose: () => root.unmount() }
}

export const mountRecorder = (node: HTMLElement, props: Parameters<typeof ShortcutRecorder>[0]) =>
  mountControl(node, ShortcutRecorder, props)
export function mountChoice(node: HTMLElement, props: Parameters<typeof ChoiceDropdown>[0]) {
  const scope = node.getRootNode() as Document | ShadowRoot
  if (!scope.querySelector('style[data-toolkit-popup]')) {
    const style = document.createElement('style')
    style.dataset.toolkitPopup = ''
    style.textContent = '@scope (fitbay-toolkit-choice) {' + popupStyles + '}'
    ;(scope instanceof Document ? scope.head : scope).append(style)
  }
  return mountControl(node, ChoiceDropdown, props)
}
