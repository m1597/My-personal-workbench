import { useState } from 'react'
import { Button, Input, Dropdown, Option, Checkbox } from '@fluentui/react-components'
export type ModelInfo = {
  active: string
  providers: { id: string; label: string; model: string; hasKey: boolean }[]
}
export function ModelSettings({
  info,
  save,
  close,
}: {
  info: ModelInfo
  save: (id: string, model: string, key: string, forget: boolean) => Promise<void>
  close: () => void
}) {
  const [id, setId] = useState(info.active),
    chosen = info.providers.find((x) => x.id === id) ?? info.providers[0]
  const [model, setModel] = useState(chosen.model),
    [key, setKey] = useState(''),
    [forget, setForget] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('')
  return (
    <form
      className="model-settings"
      onSubmit={async (e) => {
        e.preventDefault()
        setSaving(true)
        try {
          await save(id, model, key, forget)
          close()
        } catch (e) {
          setError(String(e).split('Error: ').pop() || '保存失败')
          setSaving(false)
        }
      }}
    >
      <label htmlFor="model-provider">服务商</label>
      <Dropdown
        inlinePopup
        listbox={{ className: 'component-popup' }}
        id="model-provider"
        value={chosen.label}
        selectedOptions={[id]}
        onOptionSelect={(_, data) => {
          const next = info.providers.find((x) => x.id === data.optionValue)
          if (!next) return
          setId(next.id)
          setModel(next.model)
          setKey('')
          setForget(false)
          setError('')
        }}
      >
        {info.providers.map((p) => (
          <Option key={p.id} value={p.id}>
            {p.label}
          </Option>
        ))}
      </Dropdown>
      {id !== 'offline' && (
        <>
          <label htmlFor="model-id">模型 ID</label>
          <Input id="model-id" value={model} required onChange={(_, v) => setModel(v.value)} />
          <label htmlFor="model-secret">API Key</label>
          <Input
            id="model-secret"
            type="password"
            autoComplete="off"
            value={key}
            placeholder={chosen.hasKey ? '已保存，留空沿用' : '填写此服务商的密钥'}
            onChange={(_, v) => setKey(v.value)}
          />
          {chosen.hasKey && !key && (
            <Checkbox
              label="清除此服务商的密钥"
              checked={forget}
              onChange={(_, v) => setForget(v.checked === true)}
            />
          )}
        </>
      )}
      {error && <span role="alert">{error}</span>}
      <div>
        <Button size="small" type="submit" appearance="primary" disabled={saving}>
          保存设置
        </Button>{' '}
        <Button size="small" type="button" onClick={close}>
          取消
        </Button>
      </div>
    </form>
  )
}
