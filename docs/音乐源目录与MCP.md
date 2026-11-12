# Music 音源目录和本机 Agent

打开 Music → 设置 → 音乐源 → 音源目录，勾选需要的条目后点「导入所选」。第一次打开可用内置目录，点「刷新目录」读取上游 README。每项分别报告结果，已有当前源时保留当前选择。首次成功导入后可直接使用。下拉「当前音乐源」可切换回先前导入的源。本地文件及在线直链继续支持。

仓库条目按目录 ID 合并原始与加速链接，并以脚本内容摘要识别已从本地导入的副本。刷新目录只取索引。下载脚本时优先 GitHub 原始地址，失败后尝试 GitHub Contents API 和上游列出的 gh-proxy.org 镜像。镜像可提供与 GitHub 不同的字节，导入后仍经过同一个隔离运行时。上游源会变更或失效，平台目录检索和脚本的取址操作可分别成功或失败。[上游目录](https://github.com/pdone/lx-music-source)

## 接入本机 MCP 客户端

本仓库已为 Codex 配置项目级 `fitbay_music`。从该工作区新开 Codex 会话并打开 FitBay 后，即可让 Agent 列出自己的已装音源、检查能力或切换。运行 `codex mcp get fitbay_music` 可以查看该项目实际加载的配置。其他 stdio 客户端可使用下面的配置。

已在本机 Codex app-server 直接调用四项 MCP 工具。独立 Music 窗口先导入 Fish，再多选 Fish 与 Huibq，保留当前选择并得到两项。切换到 Huibq 再切回 Fish，尝试无效目录项后两项仍在。关闭宿主及客户端、用同一测试 profile 重启后，已装清单和选中源一致。回归命令为 `node scripts/check-music-agent.mjs`，需要 Codex 客户端、已构建的桌面入口和可访问的上游目录。

先用桌面入口打开 FitBay 或 Music。把以下服务器配置放入支持标准 stdio 的本机 Agent 的项目级配置。本仓库没有改动全局 MCP 配置。当前机器的启动命令如下。

```powershell
& 'D:\nodejs\node.exe' 'D:\Desktop\个人工作台开发\scripts\music-source-mcp.mjs'
```

```json
{
  "mcpServers": {
    "fitbay-music-sources": {
      "command": "D:\\nodejs\\node.exe",
      "args": ["D:\\Desktop\\个人工作台开发\\scripts\\music-source-mcp.mjs"]
    }
  }
}
```

代理默认连接本仓库的 `local/desktop-profile`。验证专用宿主时由操作者在 args 末尾加上宿主已打开的绝对 profile 路径。标准输入输出只承载 MCP JSON-RPC。[stdio 规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)

| 工具                  | 参数示例                               | 返回                                               |
| --------------------- | -------------------------------------- | -------------------------------------------------- |
| `list_sources`        | `{}`                                   | 仓库目录、已安装源和当前 ID                        |
| `import_sources`      | `{"ids":["fish"]}`                     | 每个选中目录 ID 的结果或失败原因                   |
| `source_capabilities` | 使用上一项返回的 `{"id":"pdone:fish"}` | 已接入平台、检索方式、取址操作、音质、永久保存声明 |
| `select_source`       | 使用实际返回的源 ID                    | 切换后的能力                                       |

本地导入或从旧版迁移的源可能使用 `sha256:` ID。显示名不唯一，应始终传入实际取得的 ID。声明的音质和取址操作只描述接口。曲目是否可下载、是否能解码、是否有永久保存许可要分别确认。永久保存为 `null` 表示源没有声明，推荐自动下载继续执行原有的逐曲授权校验。

## 权限审核和验证

服务与当前 Windows 用户绑定。宿主在系统 LocalApplicationData 下原子创建仅当前用户有权限的 FitBayMusicAgent 目录，按 profile 的实际路径摘要分开描述符。启动和连接检查父目录写权限、重解析点、DACL 和所有者，验证失败时关闭该接口。每次启动生成随机命名管道和 256 位令牌。本机同一用户进程是信任边界；同一用户运行的不可信软件可使用该接口。客户端根据固定四工具清单校验参数，宿主独立再次校验。Agent 只能按目录 ID 导入，无法提供脚本内容、网页链接、文件路径或 IPC 名称。脚本照旧在工作线程中的 QuickJS WASM 加载，网络访问沿用既有公网与资源限制。

运行 `node scripts/check-music-sources.mjs` 复验旧源迁移、内容与 origin 去重、升级、不同源切换、部分失败、权限状态、错误令牌与异常 DACL 拒绝。测试会把独立 profile 的描述符临时授予内置 Users 读取权，验证连接被拒后删除。2026-11-12 实测专属目录关闭继承，唯一允许项为当前用户 FullControl；该用户及管理员仍应按正常系统安全方式保护主机。

真实来源专项使用独立 profile、后台静音宿主和官方 MCP SDK 客户端。需要现场复验时可把官方 SDK 安装在临时测试目录，项目生产依赖保持原样。

```powershell
npm run build:prototype
npm install --prefix tmp/mcp-sdk --ignore-scripts --no-audit --no-fund @modelcontextprotocol/sdk@1.32.2
$env:FITBAY_TEST_SDK_DIR = (Resolve-Path tmp/mcp-sdk).Path
node scripts/check-music-source-live.mjs fish
```

2026-11-12 对目录 Fish（脚本名 fish_music）实测。先从设置导入一个本地对照源，官方 SDK 列源、导入 Fish 并确认当前选择保持。查询能力后切换到 Fish，再切回对照源、重新选定 Fish；打开的设置页三次均自动同步。按歌名与作者找到 Kevin MacLeod 的 _Monkeys Spinning Monkeys_，该录音由作者按 CC BY 4.0 授权。平台目录返回 50 条候选，精确选择同名同艺人的录音，以声明的 320k 档手动保存 5,005,105 字节 MP3。独立 Music 本地播放器解码时长 125.074286 秒，静音播放时钟推进到 0.729785 秒。此结果限于该次录音和该源，不推定其他音质或录音许可。Huibq 同曲可检索，实际取址失败，保存和播放未验证。测试音频仅存于被 Git 忽略的隔离目录。[作者曲目与许可](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1400011)
