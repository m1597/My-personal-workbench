export function createBackButton(onBack: () => void): HTMLButtonElement
export type Category = { id: string; name: string }
export type Shell = {
  element: HTMLDivElement
  content: HTMLDivElement
  select(id: string): void
  icons: Map<string, HTMLSpanElement>
}
export function createSettingsGear(options: {
  label: string
  onClick: () => void
}): HTMLButtonElement
export function createSettingsShell<T extends string>(options: {
  title: string
  categories: ReadonlyArray<{ id: T; name: string }>
  active: T
  onSelect: (id: T) => void
  onBack: () => void
}): Shell
