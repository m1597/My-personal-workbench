# 歌曲标签与封面整理

从「设置 → 插件」安装后，在「扩展」打开。每批最多选 50 首。插件根据「艺人 - 歌名」文件名和专辑文件夹生成本地建议，可修改文字；只有勾选的字段参与写入。勾选同目录封面时按 cover、folder、front 等常用文件名查找 JPEG 或 PNG，也可在文件选择框指定本批封面。每首歌分别显示当前封面与建议封面。

支持 MP3、FLAC、标准 RIFF/WAV 和 M4A。音频在内存中校验并在同目录发布，当前每首上限 128 MiB，封面上限 8 MiB。文件或封面在预览后被换过时，需要重新预览。写入前复读生成的元数据，核对未选字段与现有图片；失败逐首反馈。

## 构建与验证

依赖锁在本插件目录。构建脚本在首次准备标签安装包时执行独立的 `npm ci --ignore-scripts`，通过项目已有的 Vite/Rolldown 将编辑器引擎放入该包。运行时使用包内的 Wasm。

- 多格式标签写入使用 `taglib-wasm@2.4.1`，发布于 2026 年 10 月，需 Node 24 或以上。JavaScript 包装层为 MIT，Wasm 遵循上游 NOTICE 的 LGPL-2.1-or-later；生成的引擎文件包含 LICENSE、NOTICE 和 COPYING.LGPL。本地可从上游重编译 Wasm 并重建插件。锁文件固定传递依赖 `@msgpack/msgpack@3.1.3`。[上游源码及许可](https://github.com/CharlesWiltgen/TagLib-Wasm)
- `node scripts/check-music-tags.mjs` 使用 MP3、FLAC、WAV 与 M4A 测试录音核对实际文件、未选字段、未选文件以及过期预览。
- 先运行 `npm run build:prototype`，再运行 `node scripts/check-music-tags.mjs --ui`，从实际引导、设置、选择插件文件及打开插件入口核对写入。测试在独立 profile 全程静音，截图输出到本次临时目录。
