import { useEffect, useState } from 'react'
import { Button, Field, Input } from '@fluentui/react-components'
import { recordShortcut } from './recordShortcut'
export function ShortcutRecorder({
  label,
  defaultValue,
  saved,
  local = false,
  change,
}: {
  label: string
  defaultValue: string
  saved: string
  local?: boolean
  change(key: string): Promise<boolean>
}) {
  const [value, setValue] = useState(saved)
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState('')
  useEffect(() => {
    setValue(saved)
  }, [saved])
  const [busy, setBusy] = useState(false)
  async function persist(key: string, failure: string) {
    if (busy) return
    setBusy(true)
    setRecording(false)
    try {
      if (await change(key)) {
        setValue(key)
        setHint('')
      } else {
        setValue(saved)
        setHint(failure)
      }
    } catch {
      setValue(saved)
      setHint(failure)
    } finally {
      setBusy(false)
    }
  }
  function begin() {
    setHint('')
    setRecording(true)
  }
  return (
    <form
      className="settings-shortcut"
      onSubmit={async (e) => {
        e.preventDefault()
        await persist(value, '保存失败，请重试')
      }}
    >
      <Field label={label} hint={hint || undefined}>
        <Input
          value={recording ? '' : value}
          disabled={busy}
          readOnly
          placeholder={recording ? '请按组合键' : '点击录制'}
          onFocus={begin}
          onClick={begin}
          onBlur={() => setRecording(false)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') return
            if (!recording && e.key === 'Enter') {
              e.preventDefault()
              begin()
              return
            }
            if (!recording) return
            e.preventDefault()
            e.stopPropagation()
            if (e.repeat || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
            if (e.key === 'Escape') {
              setRecording(false)
              setHint('')
              return
            }
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return
            const clear =
              e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
            const key = clear ? '' : recordShortcut(e.nativeEvent, local)
            if (key === undefined) {
              setHint('请按修饰键与字母、数字或导航键的组合，或直接按功能键')
              return
            }
            setValue(key)
            setHint('')
            setRecording(false)
          }}
        />
      </Field>
      <Button
        type="submit"
        size="small"
        disabled={busy || value === saved}
        aria-label={'保存' + label + '快捷键'}
      >
        保存
      </Button>
      <Button
        size="small"
        type="button"
        disabled={busy || (value === defaultValue && saved === defaultValue)}
        onClick={() => void persist(defaultValue, '恢复失败，请重试')}
      >
        恢复默认
      </Button>
    </form>
  )
}
