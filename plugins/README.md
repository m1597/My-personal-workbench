# FitBay Music 插件

[下载插件 1.0.0](https://github.com/m1597/My-personal-workbench/releases/tag/music-v1.0.0)

FitBay Music 的四个可选插件独立发布，均为 1.0.0。适用于 Windows x64 的 FitBay Music 0.1.0，需使用包含「设置 → 插件」入口的构建。通过该入口安装需要的插件。已保存在同一 Music 配置中的时间标记与智能歌单规则将继续使用。

| 插件 | 功能 | 安装文件 | SHA-256 |
| --- | --- | --- | --- |
| 波形与片段试听 | 查看波形、循环试听选段，给时间点添加标记。 | [wave.fitbayplugin](https://github.com/m1597/My-personal-workbench/releases/download/music-v1.0.0/wave.fitbayplugin) | `9d6c3dd75657eb3de73142e21e6a1cd3a7fea6ea2b5af3a1598f7f8c71343c5c` |
| 歌曲标签与封面整理 | 对照原资料和建议，选择要写入的曲目与字段。 | [tags.fitbayplugin](https://github.com/m1597/My-personal-workbench/releases/download/music-v1.0.0/tags.fitbayplugin) | `ca16e6d7104b3ee331650315db7e551a80b19619e2530a5a86efc3fb0d239ed1` |
| 智能歌单 | 按来源、入库时间和收听次数组合规则，自动更新歌单。 | [rules.fitbayplugin](https://github.com/m1597/My-personal-workbench/releases/download/music-v1.0.0/rules.fitbayplugin) | `c0711c67ad5ad19e963c04c3f5fb002dcae3eed35d19685f72e8eaa143c535e8` |

歌曲过渡可从发布页下载，再到 Music 的「设置 → 插件 → 歌曲过渡」选择插件文件安装。[下载 path.fitbayplugin](https://github.com/m1597/My-personal-workbench/releases/download/music-v1.0.0/path.fitbayplugin)，SHA-256 为 dc711c2b1003e791ca5ffb6ae79e2e3b037f95f8d864c649f7ce1a176a8a1ca4。

歌曲标签与封面整理使用 taglib-wasm 2.4.1，安装包内附 MIT、ISC、LGPL-2.1-or-later 许可及上游 NOTICE。Wasm 源码和重编译步骤见 [TagLib-Wasm](https://github.com/CharlesWiltgen/TagLib-Wasm/tree/v2.4.1)。
