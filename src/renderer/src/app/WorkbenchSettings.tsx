import { materialDefaults } from './material'
import { WorkbenchChoice } from './WorkbenchChoice'
import { useState } from 'react'
import { Button, Popover, PopoverSurface, PopoverTrigger, Slider } from '@fluentui/react-components'
import { Settings, X } from 'lucide-react'
import {
  fonts,
  languages,
  sizes,
  preferenceKey,
  useTranslation,
  type Preferences,
} from './preferences'

export function WorkbenchSettings({
  value,
  onChange,
  open,
  setOpen,
}: {
  value: Preferences
  open: boolean
  setOpen: (open: boolean) => void
  onChange: (next: Preferences) => void
}) {
  const t = useTranslation()
  const [failed, setFailed] = useState(false)
  function change(next: Preferences) {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(next))
      onChange(next)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }
  const title = t('工作台设置', 'Workbench settings')
  const fontNames = {
    default: t('默认（HarmonyOS Sans SC）', 'Default (HarmonyOS Sans SC)'),
    yahei: t('微软雅黑 UI', 'Microsoft YaHei UI'),
    segoe: 'Segoe UI Variable',
  }
  const sizeNames = {
    small: t('小', 'Small'),
    standard: t('标准', 'Standard'),
    large: t('大', 'Large'),
  }
  return (
    <Popover
      open={open}
      onOpenChange={(_, data) => setOpen(data.open)}
      positioning={{ position: 'below', align: 'end', offset: 8 }}
      trapFocus
    >
      <PopoverTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          className="settings-trigger"
          icon={<Settings size={19} />}
          aria-label={title}
          title={title}
        />
      </PopoverTrigger>
      <PopoverSurface
        role="dialog"
        aria-labelledby="workbench-settings-title"
        className="component-popup settings-surface"
      >
        <div className="settings-heading">
          <h2 id="workbench-settings-title">{title}</h2>
          <Button
            appearance="subtle"
            icon={<X size={16} />}
            aria-label={t('关闭设置', 'Close settings')}
            onClick={() => setOpen(false)}
          />
        </div>
        <WorkbenchChoice
          label={t('界面语言', 'Interface language')}
          values={languages}
          value={value.language}
          text={(key) => (key === 'en' ? 'English' : '简体中文')}
          onChange={(language) => change({ ...value, language })}
        />
        <WorkbenchChoice
          label={t('字体', 'Font')}
          values={fonts}
          value={value.font}
          text={(key) => fontNames[key]}
          onChange={(font) => change({ ...value, font })}
        />
        <WorkbenchChoice
          label={t('字号', 'Font size')}
          values={sizes}
          value={value.size}
          text={(key) => sizeNames[key]}
          onChange={(size) => change({ ...value, size })}
        />
        <fieldset className="settings-material">
          <legend>{t('背景材质', 'Background material')}</legend>
          <Button
            size="small"
            appearance="subtle"
            className="reset-material"
            onClick={() => change({ ...value, ...materialDefaults })}
          >
            {t('恢复默认', 'Restore defaults')}
          </Button>
          {(
            [
              ['transparency', t('透明度', 'Transparency')],
              ['frost', t('磨砂强度', 'Frost strength')],
              ['brightness', t('背景亮度', 'Background brightness')],
            ] as const
          ).map(([key, label]) => (
            <div className="material-control" key={key}>
              <label htmlFor={'material-' + key}>{label}</label>
              <span aria-hidden="true">{value[key]}%</span>
              <Slider
                id={'material-' + key}
                min={0}
                max={100}
                value={value[key]}
                aria-valuetext={value[key] + '%'}
                onChange={(_, data) => change({ ...value, [key]: data.value })}
              />
            </div>
          ))}
        </fieldset>
        {failed && (
          <span role="alert">
            {t(
              '保存失败，请检查应用存储空间后重试。',
              'Could not save. Check the available storage and try again.',
            )}
          </span>
        )}
      </PopoverSurface>
    </Popover>
  )
}
