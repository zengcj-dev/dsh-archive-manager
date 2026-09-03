# dsh-archive-manager

DeepSeek Harness 归档会话管理器（DSH Plugin）。

在 **设置 → 归档会话** 中列出所有已归档会话，并支持**一键恢复**——恢复后会话立即回到侧边栏会话列表，无需重启。

## 为什么需要它

DSH 0.1.1-rc.2 的"归档会话"是单向设计：右键会话只能归档，官方没有提供取消归档 / 恢复的界面或接口。本插件补上这一块：

- **查看**：列出所有归档会话（标题、创建时间、所属工作区）；
- **恢复**：一键把会话移出归档名单，会话即时回到会话列表（通过宿主 domain 变更广播，无需刷新页面）。

## 安装

发布到 GitHub 后：

```bash
dsh plugin --profile web add git+https://github.com/zengcj-dev/dsh-archive-manager.git
```

本地路径 / tarball 安装：

```bash
dsh plugin --profile web add "file:E:/dsh-archive-manager/dsh-archive-manager-0.1.0.tgz"
```

安装完成后重启 `dsh web`，打开 **设置 → 归档会话** 即可使用。

## 使用

1. 进入 **设置 → 归档会话**，页面列出所有已归档会话；
2. 点击某会话右侧的 **恢复** 按钮；
3. 会话立即回到侧边栏会话列表，历史内容完整保留。

## 工作原理

- 插件在设置页注入一个 `settings.section` 分区（DSH slots 机制）；
- 服务端注册两条同源路由：
  - `GET /plugins/dsh-archive-manager/list` —— 读取 workspace 注册表的归档名单并附上会话元数据；
  - `POST /plugins/dsh-archive-manager/unarchive` —— 通过 workspace 注册表的持久化状态机把会话 id 移出归档名单（0.1.1-rc.2 未提供公开 unarchive API，此实现绑定该版本的内部接口）；
- workspace 域名变更会触发宿主广播 `host/archived-sessions-changed`，前端会话树即时刷新。

## 兼容性

| 项 | 值 |
| --- | --- |
| DeepSeek Harness | `0.1.1-rc.2`（web profile） |
| 浏览器端 | 纯 React 18 + 原生 fetch，无构建依赖 |
| 服务端 | ESM，无运行时依赖 |

> ⚠️ 恢复功能调用了 DSH 0.1.1-rc.2 的内部接口（`workspaceRegistry.setState`）。升级 DSH 后可能需要适配；若 DSH 后续版本提供官方 unarchive API，建议改用官方接口。

## 开发

```text
plugin/
├── package.json        # dsh 插件清单（dsh.bundle / dsh.client）
├── cordis.patch.yml    # bundle patch：插入插件入口
├── lib/index.js        # 服务端：http 路由（list / unarchive）
└── client/client.js    # 浏览器端：设置页"归档会话"分区（手写 bundle）
```

无构建步骤：服务端 ESM 直接运行，浏览器 bundle 手写（`__ModuleLoader__.load` 格式），无需 tsdown/tsc。

## 许可

[MIT](LICENSE)
