export function mountToolkit(
  root: HTMLElement,
  bridge: {
    local: Record<string, (input?: unknown) => Promise<unknown>>
    shortcuts(value: unknown): Promise<unknown>
    open(tool?: string): Promise<boolean>
    capture(): Promise<boolean>
  },
): () => void
