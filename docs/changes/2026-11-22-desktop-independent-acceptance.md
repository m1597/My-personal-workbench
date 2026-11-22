# FitBay 桌面开发构建独立验收 · 2026-11-22

**本轮暂缓整体验收。** 工作台四分屏修复已独立复验通过。已复现且仍待修复的是 Skill 详情无法打开相对引用。提示词库已启用快捷键的两条恢复成功路径仍待可注册环境；其他待验项见文末。本记录统一汇总各组 FitBay 集成验收交接。

## 版本与上一轮边界

桌面 FitBay.cmd 调用本仓库 scripts/open-workbench.cmd --workbench。独立测试使用相同 Electron、dist/component-prototype/host、out/renderer/index.html 及宿主所解析的 components/toolkit，每轮使用 tmp 下新 profile。入口 --check 通过。界面显示开发版 0.1.0。采样期间其他组多次重建，观察到的 HEAD 从 d5798c3 到 cb650d9。提示词库快捷键 1817db4，Music 设置与快捷键 41a91ee、792aab5、61878a9，歌曲行 c3cc5f5；工具集截图 89409d7。不能把多个构建的结果归为同一冻结安装包。

现场一次指纹为宿主 main.mjs 的 SHA-256 27354FA2740B49AD7BE6ED78EAB6ECB9AFDD0C6335D668B68FA5A95FD00D4D94，桌面 index-BKpb6awK.js 为 63834AFF703165E34BC896034E744A6D3468C5AECAA7B3DD50A090BB60E30A04，Music component.js 为 A8A25A423FE6EE6FE3B5C090F35DF19EB2EB82D58FD70C14966200A9CF2E9096，提示词库 component.js 为 1B91963A474064AFEC0FD04ABC919C6C0EF0CB38A0E3007C4360C8313151A747。

上轮 0.2.3 为 23877c8。包内程序覆盖四分屏材质、独立与停靠入口和图片对比。同提交 Windows CI 覆盖安装、升级保留及桌面单快捷方式。上轮未覆盖本轮提示词库、铅笔输出、四向拖到底恢复及新快捷键交互。[上轮安装与桌面实测](2026-11-21-integration.md)

## 原问题与复验状态

| 负责组 | 起点与操作 | 预期 | 实际和复验证据 |
| --- | --- | --- | --- |
| 平台（已修复） | 空白工作台依次打开提示词库、工具集、Music。快速开始位于右下。将中央竖分隔线拖到最右侧，再点「布局 → 恢复分屏」。 | 四格内容、原位置和尺寸全部恢复 | 修复前三次独立 profile 均只剩三格。右上工具集从 732 × 437 变为 732 × 882，右下快速开始消失。左、上、下三个方向各自从相同起点复验，四格及尺寸均恢复。[拖动前](../images/integration-desktop-1122/right-before.png) · [恢复后](../images/integration-desktop-1122/right-restored.png) · [原始尺寸](../images/integration-desktop-1122/right.json) |
| 提示词库 | 工作台选择含 SKILL.md 和 refs/units.md 的目录，在详情点「单位表」。 | 在只读状态下打开引用并读到 QA-UNIT-017。 | 详情显示字面 Markdown，article 内链接数为零，未找到打开该引用的控件。文件仍在磁盘。[Skill 详情](../images/integration-desktop-1122/prompt-skill.png) |

## 桌面与 Music

| 项目 | 实测步骤与实际结果 |
| --- | --- |
| 更新页 | 从工作台设置打开更新。早期桌面产物的文字与按钮集中在左上。重建后执行「检查全部更新」，在 1160、520 两种窗宽截图。各有四个版本卡片，一条开发版说明，内容横向溢出均为 0。[修复前](../images/integration-desktop-1122/update-before.png) · [宽窗](../images/integration-desktop-1122/update-wide.png) · [窄窗](../images/integration-desktop-1122/update-narrow.png) |
| 四分屏、材质与控件 | 用原生窗口截图同时采集 Music、工具集、提示词库、快速开始。以 Music 为基准，四格共用深色背景，提示词库仍可见独立的目录和筛选控件。通过工作台滑块将透明度/亮度改为 40%/65%，再在两个组件设置页改为 75%/25%。两个组件分别读到相同的透明覆盖值与亮度 (0.60, 0.65)、(0.25, 0.25)。[默认四分屏](../images/integration-desktop-1122/four.png) · [首页调整后](../images/integration-desktop-1122/home-adjusted.png) · [设置调整后](../images/integration-desktop-1122/settings-adjusted.png) · [原始值](../images/integration-desktop-1122/material.json) |
| 菜单与标签 | 三个已开组件均显示同一 eye 图标，逐个隐藏后可从同菜单显示。工具集快捷入口的单色遮罩校验通过。将 Music 与工具集合到一个标签组再来回切换，检查标签栏、文字、关闭按钮及内容顶部坐标，无测得的端点跳动。逐帧动画和所有业务表单内容在隐藏后的保留仍待验。[坐标记录](../images/integration-desktop-1122/tabs.json) |
| 托盘和任务栏 | 隔离宿主观测 Electron 实际 Tray 对象及销毁，通过独立和工作台场景的单实例检查。正常任务栏参数下，仅把测试窗移到屏幕外并用 showInactive 显示。通过组件菜单打开三组件，Explorer 的 Electron 组从既有 1 个运行窗口变为 2 个，本次新增 1 个，未出现组件任务栏按钮。本开发入口归组显示 Electron。宿主计数与 Windows 通知区域含隐藏图标的全局实数仍有区别。[Explorer 对照](../images/integration-desktop-1122/taskbar.json) |
| Music 设置 | 独立和停靠点击「下载」及内容标题，区域 outline-style 均为 none；按 Tab 后内容内具体控件获得 focus-visible。配置 F8 和组合功能键，冲突、Esc、单项及全部恢复和重启状态通过。[设置实测](../images/integration-desktop-1122/music-focus.png) |
| 歌曲行 | 曲库独立宽窄窗，独立及停靠自建歌单、收藏和歌手详情，单击保留底色与暂停，双击后音频时间前进。找歌入口采用受控音源响应，独立与停靠两版专项退出码均为 0。专辑导航经过实测，其内容行、队列、最近播放等未逐表独立覆盖。[Music 交接与对应测试](2026-11-22-music-desktop-handoff.md) |

## 提示词库与工具集

| 项目 | 实测步骤与实际结果 |
| --- | --- |
| 本地导入和复制 | 无 API，从工作台快速开始选择临时目录，替代系统文件夹对话框返回路径。分别按软件开发、3D 建模筛选和搜索，填入 FitBay Demo、Scene 007。读取系统剪贴板，两条完整字符串各自与事先生成的 UTF-8 预期逐字符一致，保留未填变量、双引号、-1.250、1920 × 1080、四空格和末尾换行。首次测试的剪贴板文本恢复调用报错，测试前的文本未确认恢复。后续复制在每次操作后恢复当时保存的文本。[软件开发](../images/integration-desktop-1122/prompt-dev.png) · [Blender](../images/integration-desktop-1122/prompt-blender.png) |
| 旧数据与目录同步 | 在隔离 profile 写入旧配置和素材，再用桌面宿主打开。首次为空，取消选择后仍为空，选新目录后观察外部修改、改名、删除。关闭时再改名、改内容及删除，重启正确清除失效卡片。旧配置和测试素材内容逐字未变，组件仍为 io.fitbay.prompts。此项为旧格式 profile，不是新发行安装器升级。[重启后](../images/integration-desktop-1122/prompt-restart.png) |
| 可选 AI 与快捷键 | 本地回环测试服务返回固定内容，取消预览后无新卡片，确认后出现副本，Skill 与参考文件保持原内容。提示词库快捷键在独立与停靠入口完成 F8、冲突、取消、单项及全部恢复、重启复验。并行运行期间一次启用 F8 未注册，单列为环境相关未决样本。默认键被占用时保留 F8 和启用状态的冲突路径已验。[提示词跨入口专项](2026-11-22-prompt-integration.md) |
| 截图与遮罩 | 从工作台停靠按钮、独立窗口和已注册的系统快捷键实际框选。用另一窗口粘贴并比对整张图。停靠入口再画一笔，第二轮同样画线经系统另存为对话框保存，解码逐像素一致。每个入口各按 Esc，用 Windows WindowFromPoint 验证正常输出及取消后的鼠标命中回到样张，三入口均通过。停靠入口保存后亦通过命中检查。原生显示样张红绿分明，OCR 读到 FITBAY 321，未复现整屏蓝色。集中原生测试后原窗口焦点已核对恢复。[真实色块](../images/integration-desktop-1122/actual-colors.png) · [粘贴图](../images/integration-desktop-1122/pencil-paste.png) · [保存图](../images/integration-desktop-1122/pencil-save.png) |
| 工具集首页、设置与快捷键 | 独立和停靠均见截图、划词、取色，设置后返回首页；首页取色可复制颜色。旧选择器等待「录制快捷键」超时，新版使用只读输入框录制。新版独立入口 F8、Esc、冲突、停用、全部恢复与两次重启通过，停靠入口早前通过单项恢复。所有键在启用且默认键可用时的恢复、工具集同类设置鼠标与 Tab 焦点仍待验。 |

## 下一次交接

等待提示词库交付相对引用修复，再按原样例复验。屏幕测距已从验收范围移除。保留屏幕取色，首页独立取色已有实测；同一截图选区直接取色的旧入口在首轮未见，仍单列待核。新发行安装包的安装、升级、桌面单快捷方式，当前用户原配置和业务数据的安装器迁移，均等待打包交付。旧文件库图片快速预览和多选发送工具集改名/改尺寸，在原位升级后的提示词库首页未见旧入口，须由项目规范明确旧操作的适用入口。远程 CI 和全仓检查未在此独立验收中重跑，Music 交接记录的全仓检查停在格式检查。未推送或发布。
## 平台修复与提示词库专项归并

平台提交 52a318d、67c06cf。独立复测使用桌面开发版 0.1.0，工作台渲染产物 index-DEkb0Wy5.js 的 SHA-256 为 DC6B70F76F80ECFC9A5872C89D8460D6E5DEF5F49238BBF817F2BE2020A59254。沿用上次失败顺序打开提示词库、工具集、Music，中央竖分隔线拖至最右。布局菜单现显示「恢复分屏 · 工具集、快速开始」。点击后右下快速开始与其按钮恢复，四格逐一比对，宽高与起点完全相同。独立 profile 的桌面启动脚本再测，工具集眼睛隐藏、显示，以及收起后用眼睛恢复提示词库均通过。更新页在两种窗宽均有四张卡片，实测视口 1175 和 535，横向溢出均为 0。[修复后同屏](../images/integration-desktop-1122/right-fixed.png) · [逐格尺寸](../images/integration-desktop-1122/right-fixed.json) · [宽窗](../images/integration-desktop-1122/update-wide-fixed.png) · [窄窗](../images/integration-desktop-1122/update-narrow-fixed.png)

提示词库专项 f6c9a5c 的证据按其报告中的组件构建摘要归档。已覆盖工作台设置搜索、独立和停靠入口、分类选中与内容控件焦点、快捷键录制、取消、冲突、重启和旧格式数据迁移。本轮未重复执行这些用例。当前桌面 prompts/component.js 摘要见前文，与该专项报告所列摘要不同。唯一剩余的提示词库快捷键专项，是功能已启用且默认组合可注册时，分别从单项恢复、组件全部恢复成功注册默认组合并释放原键。本机预检 Ctrl+Alt+Shift+P 未能注册，新建的隔离 Windows 桌面也返回 1409（已注册）；本轮未更改占用者，两个成功分支均保留待验。远程 CI、发行包实装与人工前台体验按各自交付范围保留未验。[合并的专项证据](2026-11-22-prompt-integration.md)
