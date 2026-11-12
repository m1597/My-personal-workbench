import { useState } from 'react'
import type { DockviewApi } from 'dockview-react'
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
} from '@fluentui/react-components'
import { X } from 'lucide-react'
import {
  captureLayout,
  readPresets,
  savePresets,
  switchLayout,
  type LayoutPresets,
} from './layoutStorage'

export function LayoutDialog({ api, onClose }: { api: DockviewApi; onClose(): void }) {
  const [presets, setPresets] = useState(readPresets)
  const [selected, setSelected] = useState(presets.defaultName ?? presets.items[0]?.name ?? '')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const chosen = presets.items.find((item) => item.name === selected)
  const save = (next: LayoutPresets, feedback: string) => {
    try {
      savePresets(next)
      setPresets(next)
      setMessage(feedback)
      return true
    } catch {
      setMessage('保存失败，请检查应用存储空间后重试。')
      return false
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open) onClose()
      }}
    >
      <DialogSurface className="component-popup workbench-dialog">
        <DialogBody>
          <DialogTitle
            action={
              <Button
                appearance="subtle"
                aria-label="关闭布局"
                icon={<X size={16} />}
                onClick={onClose}
              />
            }
          >
            布局
          </DialogTitle>
          <DialogContent className="layout-content">
            <form
              className="layout-create"
              onSubmit={(event) => {
                event.preventDefault()
                const trimmed = name.trim()
                if (!trimmed) return
                if (presets.items.some((item) => item.name === trimmed)) {
                  setMessage('此名称已存在。请选择已有布局并点击「更新快照」。')
                  return
                }
                if (
                  save(
                    {
                      ...presets,
                      items: [...presets.items, { name: trimmed, layout: captureLayout(api) }],
                    },
                    '已保存当前布局。',
                  )
                ) {
                  setSelected(trimmed)
                  setName('')
                }
              }}
            >
              <Field label="新布局名称">
                <Input value={name} maxLength={80} onChange={(_, data) => setName(data.value)} />
              </Field>
              <Button type="submit" appearance="primary" disabled={!name.trim()}>
                保存当前布局
              </Button>
            </form>
            {presets.items.length > 0 && (
              <>
                <Field label="已保存的布局">
                  <Select
                    value={selected}
                    onChange={(_, data) => {
                      setSelected(data.value)
                      setMessage('')
                    }}
                  >
                    {presets.items.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                        {item.name === presets.defaultName ? '（默认）' : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="layout-actions">
                  <Button
                    disabled={!chosen}
                    onClick={() => {
                      if (chosen) {
                        switchLayout(api, chosen.layout)
                        onClose()
                      }
                    }}
                  >
                    切换布局
                  </Button>
                  <Button
                    disabled={!chosen}
                    onClick={() =>
                      chosen &&
                      save(
                        {
                          ...presets,
                          items: presets.items.map((item) =>
                            item === chosen ? { ...item, layout: captureLayout(api) } : item,
                          ),
                        },
                        '已更新所选快照。',
                      )
                    }
                  >
                    更新快照
                  </Button>
                  <Button
                    disabled={!chosen || chosen.name === presets.defaultName}
                    onClick={() =>
                      chosen && save({ ...presets, defaultName: chosen.name }, '已设为默认布局。')
                    }
                  >
                    设为默认
                  </Button>
                </div>
              </>
            )}
            <div className="layout-restore">
              <Button
                onClick={() => {
                  switchLayout(
                    api,
                    presets.items.find((item) => item.name === presets.defaultName)?.layout,
                  )
                  onClose()
                }}
              >
                还原默认布局
              </Button>
            </div>
            {message && <span role="status">{message}</span>}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
