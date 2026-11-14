import { WorkbenchChoice } from './WorkbenchChoice'
import { useTranslation } from './preferences'
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
} from '@fluentui/react-components'
import { X } from 'lucide-react'
import {
  captureLayout,
  selectLayoutName,
  readPresets,
  savePresets,
  switchLayout,
  type LayoutPresets,
} from './layoutStorage'

export function LayoutDialog({ api, onClose }: { api: DockviewApi; onClose(): void }) {
  const t = useTranslation()
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
      setMessage(
        t(
          '保存失败，请检查应用存储空间后重试。',
          'Could not save. Check the available storage and try again.',
        ),
      )
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
                aria-label={t('关闭布局', 'Close layouts')}
                icon={<X size={16} />}
                onClick={onClose}
              />
            }
          >
            {t('布局', 'Layouts')}
          </DialogTitle>
          <DialogContent className="layout-content">
            <form
              className="layout-create"
              onSubmit={(event) => {
                event.preventDefault()
                const trimmed = name.trim()
                if (!trimmed) return
                if (presets.items.some((item) => item.name === trimmed)) {
                  setMessage(
                    t(
                      '此名称已存在。请选择已有布局并点击「更新快照」。',
                      'This name already exists. Select its layout and choose Update snapshot.',
                    ),
                  )
                  return
                }
                if (
                  save(
                    {
                      ...presets,
                      items: [...presets.items, { name: trimmed, layout: captureLayout(api) }],
                    },
                    t('已保存当前布局。', 'Current layout saved.'),
                  )
                ) {
                  selectLayoutName(trimmed)
                  setSelected(trimmed)
                  setName('')
                }
              }}
            >
              <Field label={t('新布局名称', 'New layout name')}>
                <Input value={name} maxLength={80} onChange={(_, data) => setName(data.value)} />
              </Field>
              <Button type="submit" appearance="primary" disabled={!name.trim()}>
                {t('保存当前布局', 'Save current layout')}
              </Button>
            </form>
            {presets.items.length > 0 && (
              <>
                <WorkbenchChoice
                  label={t('已保存的布局', 'Saved layouts')}
                  values={presets.items.map((item) => item.name)}
                  value={selected}
                  text={(name) =>
                    name + (name === presets.defaultName ? t('（默认）', ' (default)') : '')
                  }
                  onChange={(name) => {
                    setSelected(name)
                    setMessage('')
                  }}
                />
                <div className="layout-actions">
                  <Button
                    disabled={!chosen}
                    onClick={() => {
                      if (chosen) {
                        switchLayout(api, chosen.layout)
                        selectLayoutName(chosen.name)
                        onClose()
                      }
                    }}
                  >
                    {t('切换布局', 'Switch layout')}
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
                        t('已更新所选快照。', 'Snapshot updated.'),
                      )
                    }
                  >
                    {t('更新快照', 'Update snapshot')}
                  </Button>
                  <Button
                    disabled={!chosen || chosen.name === presets.defaultName}
                    onClick={() =>
                      chosen &&
                      save(
                        { ...presets, defaultName: chosen.name },
                        t('已设为默认布局。', 'Default layout set.'),
                      )
                    }
                  >
                    {t('设为默认', 'Set as default')}
                  </Button>
                </div>
              </>
            )}
            <div className="layout-restore">
              <Button
                onClick={() => {
                  selectLayoutName(presets.defaultName ?? '')
                  switchLayout(
                    api,
                    presets.items.find((item) => item.name === presets.defaultName)?.layout,
                  )
                  onClose()
                }}
              >
                {t('还原默认布局', 'Restore default layout')}
              </Button>
            </div>
            {message && <span role="status">{message}</span>}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
