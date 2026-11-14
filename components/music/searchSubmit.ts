import type { KeyboardEvent } from 'react'

export function guardSearchEnter(event: KeyboardEvent<HTMLFormElement>) {
  if (
    event.key === 'Enter' &&
    (event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
  )
    event.preventDefault()
}
