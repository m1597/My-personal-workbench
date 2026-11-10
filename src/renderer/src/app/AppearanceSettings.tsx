import {
  Button,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Field,
  Select,
} from '@fluentui/react-components'
import { Settings, X, RotateCcw } from 'lucide-react'
import type { Appearance } from './appearance'
import { defaultAppearance } from './appearance'
import type { Theme } from '../../../shared/theme'

type Props = {
  value: Appearance
  theme: Theme
  onChange(value: Appearance): void
  onTheme(theme: Theme): void
  saved: boolean
}
export function AppearanceSettings({ value, theme, onChange, onTheme, saved }: Props) {
  return (
    <Dialog>
      <DialogTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          icon={<Settings size={18} />}
          aria-label="软件设置"
          title="软件设置"
        />
      </DialogTrigger>
      <DialogSurface className="workbench-dialog appearance-dialog">
        <DialogBody>
          <DialogTitle
            action={
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="subtle" icon={<X size={18} />} aria-label="关闭设置" />
              </DialogTrigger>
            }
          >
            软件设置
          </DialogTitle>
          <DialogContent>
            <div className="settings-intro">
              <span>个性化</span>
              <p>外观随你而定。修改即时生效，关闭窗口后仍会保留。</p>
            </div>
            <div className="settings-grid">
              <Field label="颜色主题" hint="为整个工作台选择深色或浅色。" orientation="horizontal">
                <Select value={theme} onChange={(_, data) => onTheme(data.value as Theme)}>
                  <option value="dark">深色</option>
                  <option value="light">浅色</option>
                </Select>
              </Field>
              <Field
                label="界面材质"
                hint="调整玻璃透光程度，或使用实色底。"
                orientation="horizontal"
              >
                <Select
                  value={value.material}
                  onChange={(_, data) =>
                    onChange({ ...value, material: data.value as Appearance['material'] })
                  }
                >
                  <option value="glass">通透玻璃</option>
                  <option value="soft">柔和磨砂</option>
                  <option value="solid">纯色 · 更高可读性</option>
                </Select>
              </Field>
              <Field
                label="界面密度"
                hint="调整工具栏、标签和列表的间距。"
                orientation="horizontal"
              >
                <Select
                  value={value.density}
                  onChange={(_, data) =>
                    onChange({ ...value, density: data.value as Appearance['density'] })
                  }
                >
                  <option value="comfortable">舒适</option>
                  <option value="compact">紧凑</option>
                </Select>
              </Field>
              <Field label="强调色" hint="用于选中状态、焦点和主要操作。" orientation="horizontal">
                <Select
                  value={value.accent}
                  onChange={(_, data) =>
                    onChange({ ...value, accent: data.value as Appearance['accent'] })
                  }
                >
                  <option value="blue">经典蓝</option>
                  <option value="neutral">石墨灰</option>
                  <option value="violet">柔紫</option>
                </Select>
              </Field>
              <Field label="面板边角" hint="统一停靠面板与标签的轮廓。" orientation="horizontal">
                <Select
                  value={value.corners}
                  onChange={(_, data) =>
                    onChange({ ...value, corners: data.value as Appearance['corners'] })
                  }
                >
                  <option value="rounded">柔和圆角</option>
                  <option value="square">利落直角</option>
                </Select>
              </Field>
              <div className="settings-font">
                <span>中文字体</span>
                <p>HarmonyOS Sans SC</p>
                <small>本机字体 · 未安装时回退微软雅黑 UI</small>
              </div>
            </div>
            <p className="settings-note">
              玻璃效果取决于 Windows
              透明设置；不支持时使用本地底色。此处调整工作台外观，不改变系统设置或第三方组件。
            </p>
            <p role="status" className="settings-save">
              {saved
                ? '外观已保存到此工作区'
                : '当前外观已应用，但无法写入本地存储，重启后可能丢失。'}
            </p>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="subtle"
              icon={<RotateCcw size={15} />}
              onClick={() => {
                onChange({ ...defaultAppearance })
                onTheme('dark')
              }}
            >
              恢复默认外观
            </Button>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="primary">完成</Button>
            </DialogTrigger>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
