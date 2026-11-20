## Why

工作台需要从设置搜索结果直接打开 Music 的对应分类。

## What Changes

Music 清单列出当前九个分类的名称、展示路径和稳定目标。Music 响应宿主发送的设置请求。

## Capabilities

### Modified Capabilities

- `music-settings`：提供分类目标并支持从宿主定位。

## Impact

Music 提供条目和接收端，工作台组负责共享接口、组件发现、搜索结果和窗口激活。
