# Requirements Memory

[English](README.md) | [简体中文](README.zh-CN.md)

Requirements Memory 是一个本地 Codex 插件，用于跨多个代码工作区记录、检索和维护结构化的业务需求记忆。

它适合这样的场景：你经常和 Codex 讨论需求、方案和实现细节，希望 Codex 在后续开发时能可靠地找回明确的需求事实、产品决策、业务规则、约束条件、验收口径和跨仓库上下文，而不是只依赖当前对话历史或模糊的长期记忆。

## 为什么需要这个插件

Codex 可以使用当前对话上下文，也可以使用内置 Memories。但是需求类信息通常需要更强的结构和可追溯性：

- 需求应该是明确的、可审阅的、可追溯的。
- 一个业务需求可能横跨多个代码仓库或 workspace。
- 需求变更应该保留版本，而不是被静默覆盖。
- Codex 在输出技术方案或修改代码前，应该先检索相关需求事实。
- 新记忆不应该被自动写入，用户需要确认哪些内容可以变成持久记忆。

Requirements Memory 提供一个本地结构化存储层和一组 MCP 工具，专门处理这类需求记忆工作流。

## 插件能做什么

- 创建独立于单个代码仓库的业务需求空间。
- 将 workspace 下的 session profile 绑定到一个主业务空间。
- 支持配置引用空间，用于跨业务域检索上下文。
- 从当前对话或本地文档中提取候选记忆。
- 写入记忆前必须经过用户明确确认。
- 对已有记忆做版本化更新，避免静默覆盖。
- 支持按关键词、维度、标签、类型、状态和可选语义向量检索。
- 默认使用归档方式删除，也支持显式硬删除。
- 在本地写入 JSON 状态文件、事件日志和便于人工阅读的 Markdown 镜像。

## 核心概念

### Business Space

`businessSpace` 是业务级的需求记忆容器，不等同于 Git 仓库。

例如，一个“订单中心”业务空间可能同时关联：

- `order-api`
- `order-admin`
- `settlement-service`
- `mobile-order-page`

插件会把需求事实存放在业务空间下。这样即使一个需求涉及多个代码仓库，相关上下文仍然保持在同一个业务语义容器里。

### Session Profile

`sessionProfile` 是插件在某个 workspace 下维护的命名上下文。默认 profile 是 `default`。

绑定关系是：

```text
workspacePath + sessionProfile -> 主 businessSpace + 可选引用空间
```

这种设计不依赖 Codex 内部线程 ID。同一个 workspace 可以有多个 profile，例如：

- `default`
- `pricing-v2`
- `settlement-migration`
- `risk-control`

写入永远进入主业务空间。引用空间只用于检索，不作为默认写入目标。

### Requirement Memory

一条需求记忆是一条结构化的需求事实，包含：

- 类型：`requirement`、`decision`、`constraint`、`business-rule`、`preference` 或 `note`
- 标题和摘要
- 固定维度，例如 project、module、feature、role、scenario、constraint、decision、priority、owner
- 自定义维度
- 标签
- 状态
- 版本
- 证据摘要和短引用

这个结构比普通笔记更严格，目的是让 Codex 能稳定检索、解释和应用这些记忆。

## 工作原理

Requirements Memory 由两部分组成：

1. `skills/requirements-memory/SKILL.md` 中的 Codex skill。
2. `src/server.ts` 中的本地 MCP server。

Skill 负责告诉 Codex 什么时候使用插件，以及应该遵循什么工作流：

- 在需求敏感任务前先检索相关记忆。
- 在需求讨论后只提出候选记忆。
- 写入持久记忆前必须询问用户。
- 当某条记忆影响回答、方案或实现时，引用对应 memory id。

MCP server 负责真正的数据读写、检索、导入、更新和删除。它通过 stdio 运行，数据默认保存在本机。

## 本地数据目录

默认数据目录是：

```text
~/.codex/requirements-memory
```

Windows 下通常是：

```text
%USERPROFILE%\.codex\requirements-memory
```

目录结构如下：

```text
requirements-memory/
  bindings.json
  spaces/
    <spaceId>/
      current.json
      events.jsonl
      memory.md
  indexes/
    <spaceId>.json
```

各文件作用：

- `bindings.json`：保存 workspace/profile 到业务空间的绑定关系。
- `current.json`：保存某个业务空间的当前有效状态。
- `events.jsonl`：保存追加式版本事件。
- `memory.md`：当前活跃记忆的人类可读镜像。
- `indexes/*.json`：可选语义向量索引元数据。

可以通过环境变量覆盖数据目录：

```bash
REQUIREMENTS_MEMORY_HOME=/path/to/data
```

## 检索模型

检索会综合使用：

- 关键词匹配
- 维度过滤
- 标签、类型和状态过滤
- 更新时间和活跃状态加权
- 可选语义向量排序

如果配置了 `OPENAI_API_KEY`，插件可以使用 OpenAI embeddings 做语义排序。如果没有配置 key，会自动降级为关键词和维度检索。

出于隐私考虑，生成 embeddings 时只会使用：

- 标题
- 摘要
- 维度
- 自定义维度
- 标签

证据短引用和原始来源文本不会被发送用于 embeddings。

## MCP 工具列表

插件暴露以下 MCP 工具：

| 工具 | 作用 |
| --- | --- |
| `create_business_space` | 创建业务需求记忆空间。 |
| `list_business_spaces` | 列出本地业务空间。 |
| `bind_session_profile` | 将 workspace profile 绑定到主业务空间和可选引用空间。 |
| `get_session_context` | 读取 workspace/profile 的绑定上下文。 |
| `list_session_profiles` | 列出 session profile 绑定关系。 |
| `prepare_memory_candidates` | 从文本中提取候选记忆，不写入。 |
| `upsert_memory` | 创建或版本化更新已确认的记忆。 |
| `search_memories` | 按查询词、维度、标签、类型、状态和可选 embeddings 检索。 |
| `import_document` | 从 `.md`、`.txt` 或 `.json` 文档中提取候选记忆。 |
| `archive_memory` | 软删除记忆，保留版本历史。 |
| `delete_memory` | 显式确认后硬删除记忆。 |
| `rebuild_index` | 重建可选语义向量索引。 |
| `read_space` | 读取某个业务空间的当前结构化内容。 |

## 本地开发安装

克隆仓库：

```bash
git clone https://github.com/HuYellow/requirements-memory.git
cd requirements-memory
```

安装依赖并构建：

```bash
npm install
npm run build
```

运行测试：

```bash
npm test
node tests/mcp-smoke.mjs
```

插件 manifest 位于：

```text
.codex-plugin/plugin.json
```

MCP 配置位于：

```text
.mcp.json
```

MCP 启动方式是：

```bash
node scripts/start-server.mjs
```

启动脚本依赖 `dist/src/server.js`，因此使用前需要先运行 `npm run build`。

## 在 Codex 中安装

本地开发时，可以将仓库放到本地插件目录，并在 Codex plugin marketplace 中添加条目。

示例 marketplace entry：

```json
{
  "name": "requirements-memory",
  "source": {
    "source": "local",
    "path": "./plugins/requirements-memory"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

然后从 marketplace 安装：

```bash
codex plugin add requirements-memory@personal
```

安装后建议新开一个 Codex thread，让 skill 和 MCP tools 被重新加载。

## 使用示例

创建业务空间：

```text
创建一个名为“订单中心”的业务需求空间。
```

绑定当前 workspace：

```text
把当前 workspace 的 default sessionProfile 绑定到“订单中心”业务空间。
```

从需求讨论中记录记忆：

```text
从这段需求讨论中提取候选记忆。先不要写入，等我确认。
```

实现前检索记忆：

```text
在实现订单取消逻辑前，先检索相关需求记忆。
```

导入本地文档：

```text
把 docs/order-cancel.md 中的需求导入到“订单中心”业务空间，先生成候选记忆。
```

## 版本和删除策略

记忆更新是版本化的。当更新已有记忆时，插件会：

- 增加记忆版本号
- 更新当前状态
- 向 `events.jsonl` 追加事件

删除有两种模式：

- `archive_memory`：默认软删除，保留历史。
- `delete_memory`：硬删除，需要显式确认，并清理对应向量索引内容。

## 隐私说明

- 数据默认只保存在本机。
- 插件不会在未经确认的情况下写入记忆。
- v1 文档导入只支持 `.md`、`.txt` 和 `.json`。
- 语义检索是可选能力，需要配置 `OPENAI_API_KEY`。
- embeddings 不包含证据短引用或完整原始来源文本。

## 开发命令

常用命令：

```bash
npm run build
npm test
node tests/mcp-smoke.mjs
```

项目结构：

```text
.codex-plugin/
  plugin.json
.mcp.json
skills/
  requirements-memory/
    SKILL.md
scripts/
  start-server.mjs
src/
  server.ts
  fsStore.ts
  search.ts
  candidates.ts
  schemas.ts
tests/
  store.test.ts
  mcp-smoke.mjs
```

## 当前限制

- 暂不提供云同步服务。
- 暂不提供多用户权限模型。
- 暂不提供 UI 面板。
- v1 暂不支持 Word/PDF 导入。
- 语义检索需要 OpenAI API key，且是可选能力。

## License

MIT

