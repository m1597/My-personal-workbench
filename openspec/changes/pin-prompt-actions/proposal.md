## Why

固定提示词为工具集动作使本地提示词可直接复用。

## What Changes

仓库 MUST 为固定文件生成持久 ID，并在每次执行时读取当前文件。

## Capabilities

### New Capabilities

- `pin-prompt-actions`：固定提示词为工具集动作。

### Modified Capabilities

无。

## Impact

第一方提示词组件、桌面入口与本地 profile。
