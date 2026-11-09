import {
  Button,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@fluentui/react-components'
import { HelpCircle, X } from 'lucide-react'

export function HelpDialog() {
  return (
    <Dialog>
      <DialogTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          icon={<HelpCircle size={18} />}
          aria-label="操作帮助"
          title="操作帮助"
        />
      </DialogTrigger>
      <DialogSurface className="workbench-dialog">
        <DialogBody>
          <DialogTitle
            action={
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="subtle" icon={<X size={18} />} aria-label="关闭帮助" />
              </DialogTrigger>
            }
          >
            让工作区适合你的习惯
          </DialogTitle>
          <DialogContent>
            <p>四个模块都是占位面板，你可以先体验布局。</p>
            <dl>
              <dt>移动面板</dt>
              <dd>拖住模块标签，放到高亮区域。</dd>
              <dt>合并标签</dt>
              <dd>将标签拖到另一个面板的标签栏。</dd>
              <dt>调整大小</dt>
              <dd>拖动面板之间的分隔线。</dd>
              <dt>重新打开</dt>
              <dd>点击顶部「窗口」菜单或模块图标。</dd>
              <dt>还原布局</dt>
              <dd>点击右上角「重置布局」。</dd>
            </dl>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="primary">知道了</Button>
            </DialogTrigger>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
