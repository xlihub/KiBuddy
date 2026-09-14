---
name: ki-release-maintenance
description: 只读检查 Ki-Buddy、Ki-Core 与 Ki-Model 的发布状态、版本映射和上游候选版本，并按 PR、Actions run 或 tag 恢复维护状态。用于管理员询问 Ki 产品版本现状、AionUi/AionCore/aionrs 累计变化、发布基准选择、兼容性信号或中断后的状态恢复；只生成发布规划，不执行写操作。
---

# Ki 产品发布维护

只读取本地仓库和 GitHub 状态，输出可核验的发布报告与规划。管理员明确选择发布基准后仍停留在规划阶段。

## 权威资料

开始检查前按用途读取：

- `CONTEXT.md`：使用维护领域术语时读取。
- `docs/adr/0001-ki-independent-release-cadence.md`：解释为何不自动采用上游版本时读取。
- `docs/contributing/upstream-release-analysis-and-target-alignment.zh-CN.md`：核对四个仓库的发布机制、资产来源和版本映射时读取。
- `docs/contributing/maintainer-release-and-maintenance-handbook.zh-CN.md`：筛选上游候选版本、恢复状态或规划管理员下一步时读取。

使用“上游候选版本”“发布基准”“独立发布节奏”。命令、路径、API 名、tag、branch 和 label 保留原文，其余管理员可见内容使用简体中文。

## 只读边界

允许读取文件、Git 状态、remote、PR、Actions run、tag、Release、compare 和 checks。优先使用已连接的 GitHub 工具；使用 `gh` 前检查 `gh auth status`，认证不可用时报告具体缺口，继续输出仍可由本地文件证明的内容。

整个执行期间保持以下状态：

- 工作树、refs、GitHub 对象和 Release 资产不变。
- 不执行 `git clone`、`fetch`、`pull`、`checkout`、`switch`、`stash`、`branch`、`worktree`、`commit`、`tag` 或 `push`。
- 不创建、编辑、合并或关闭 PR，不触发或重跑 workflow，不创建或修改 Release。
- 不把无法读取的远端状态推断为“最新”“成功”或“完整”。

如果用户要求立即执行写操作，先完成本 skill 的报告，再检查仓库是否已经提供适用于目标仓库的发布 skill。只有目标 skill 存在时才交接；尚未提供写入入口时报告该限制并停止。不得在本 skill 内执行写操作。

## 1. 发现相关 Ki 产品仓库

1. 使用 `git rev-parse --show-toplevel` 找到当前 worktree，并读取 `git remote -v`。
2. 按用户目标及其实际依赖映射确定本次需要的仓库，不为 Ki-Model 单仓检查强制要求 Ki-Buddy/Ki-Core clone。规范化 SSH、HTTPS 和带 `.git` 后缀的 remote URL，以 `owner/repo` 作为仓库身份。只接受：
   - `xlihub/KiBuddy`
   - `xlihub/Ki-Core`
   - `xlihub/Ki-Model`
     历史公开仓库 `xlihub/Ki-Buddy` 不属于当前源码仓库，只能作为 0.1.7 及更早版本的 tag、Release 和资产证据来源；不能选为 Ki-Buddy clone、PR、run 或 tag 的操作目标。
3. 从当前仓库的父目录动态搜索有限深度内的 `.git` 目录或文件，并检查每个候选的 remote。也检查当前 clone 的 `git worktree list --porcelain` 结果。不要依赖固定本地路径，不要扫描整个主目录。
4. 仅把 remote 匹配目标 `owner/repo` 的目录列为候选；目录名不能作为仓库身份依据。
5. 对每个候选显示绝对路径、当前 branch、HEAD 和工作树是否有修改。

同一仓库只有一个候选时采用该路径。缺少候选时给出以下选择并等待管理员回复：

1. 提供已有 clone 的路径
2. 提供额外搜索根目录
3. 停止检查

同一仓库存在多个候选时，按编号列出路径和状态，等待管理员明确选择。不得自动 clone，也不得按目录名、最近修改时间或干净程度代替管理员选择。

仓库发现完成条件：本次所需的每个 Ki 产品各有一个经 remote 验证且由管理员接受的路径，或明确报告缺口。

## 2. 建立当前版本映射

从选定 clone 读取以下来源：

- Ki-Buddy：`ki-buddy-version.txt`、`ki-buddy-release.json`、`ki-buddy-product.json`
- Ki-Core：`ki-core-version.txt`、`ki-core-upstream.json`、`ki-core-versions.json`
- Ki-Model：`ki-model-version.txt`、`ki-model-upstream.json`、`ki-model-versions.json`；同时单独读取 `ki-model-upstream-pending.json`，区分待发布与已发布基准。

Ki-Model 初次发布前可能只有 pending 文件，缺少产品版本和已发布映射时报告“尚未发布”，不创建文件或补造版本。读取 Core 的 Cargo.toml/Cargo.lock，确认它实际引用 Ki-Model 还是直接引用 aionrs；六个 aion-\* crate 的来源与 revision 应分别核对。

按实际消费关系交叉核对映射。Ki-Buddy / Ki-Core 原有映射为：

```text
Ki-Buddy release/tag/commit
├── AionUi tag/commit
└── Ki-Core release/tag/commit
    └── AionCore tag/peeled commit
```

Core 已采用 Ki-Model 时，在 Core 下增加 `Ki-Model release/tag/commit → aionrs tag/peeled commit`；Core 仍直接引用 aionrs 时如实标明，不把未发布的 Ki-Model pending 当作已消费 SDK。Ki-Model 单仓检查直接报告其产品版本及 aionrs 基准。

分别读取实际映射中各个 tag 对应的 GitHub Release，确认 `isDraft`、`isPrerelease`、`publishedAt`、tag commit 和资产。Ki-Buddy 使用 `ki-buddy-product.json` 声明的内部 Release；Ki-Core、Ki-Model、AionUi、AionCore 和 aionrs 使用各自的公开 Release。当前映射与对应 Release 不一致时逐项列出，不选择新的发布基准。

报告必须区分：

- 本地映射声明
- Ki-Buddy 内部 Release 状态
- Ki-Core、Ki-Model、AionUi、AionCore、aionrs 的公开 Release 事实，以及 Ki-Buddy 历史公开分发证据
- 无法验证的字段

当前状态完成条件：本次相关产品及其实际上游/SDK 来源的版本和 commit 均有明确证据，或每个证据缺口均已标明；pending 与已发布状态分开报告。

## 3. 筛选上游候选版本

分别以 `ki-buddy-release.json` 中的 AionUi tag、`ki-core-upstream.json` 中的 AionCore tag、`ki-model-upstream.json` 中的 aionrs tag 作为已发布基准。Ki-Model 尚未发布时，用已确认的 pending 作为初始化比较起点，并明确它尚非已发布映射。

读取全部相关 Release；使用 `gh` 时可先运行：

```bash
gh release list --repo <owner/repo> --exclude-drafts --exclude-pre-releases \
  --limit 100 --json tagName,publishedAt,isDraft,isPrerelease
```

候选判定以维护手册“2.1 查看当前发布基准和上游候选版本”为唯一规则来源，逐项应用，不在本 skill 中另设更宽或更窄的定义。资产预期按维护手册指向的目标 tag workflow 和验证脚本读取。Ki-Model 同时读取其 clone 的 `docs/ki-model/maintenance.md`，沿用同一独立发布原则；SDK 来源与 CLI 资产分别按目标 tag 的真实承诺核对，不机械套用桌面安装包矩阵。管理员明确批准的初始化例外只适用于记录中的准确 tag/peeled commit，不自动放宽其他候选。

把不满足完整性规则的 Release 单独列为“尚不完整”并写明证据。无法取得完整 Release 列表时标明查询范围，不声称没有其他候选版本。

## 4. 分析每个候选版本

对每个上游候选版本都提供相对当前发布基准的累计报告，不只报告相邻版本：

- 从当前发布基准到候选 tag 的 Release Notes/CHANGELOG 累计变化
- 候选 Release 的全部资产名称、数量和完整性结果
- `https://github.com/<owner>/<repo>/compare/<base>...<target>` compare 链接
- compare API 的 `ahead_by`、`behind_by`、commit 数和 changed paths
- 兼容性信号及其证据

使用 GitHub compare API 时记录返回限制。文件列表达到 API 上限或查询被截断时明确标为“不完整”，不要把已返回列表当作全部 changed paths。

兼容性信号至少检查：

- API、协议、数据库 migration、IPC/preload 边界；Ki-Model 重点检查 OpenAIProvider、SSE、agent/session 和 Core 消费的公开 Rust API
- 产品版本、tag、Release workflow、资产命名和 checksums
- Ki-Core 下载、manifest、provenance 与平台矩阵
- 依赖、lockfile、构建工具链和 runner
- Release Notes 中的 breaking、migration、deprecated、security 或 platform 说明

信号按“已发现风险”“未发现已知风险”“证据不足”输出。只有可引用的 Release Notes、changed path、check 或维护文档才算证据。

候选分析完成条件：每个候选版本都有累计变化、资产、compare、changed paths 和兼容性信号；缺失项均标明原因。

## 5. 让管理员选择发布基准

先用表格汇总当前发布基准和所有上游候选版本，再给出编号选择：

1. 保留当前发布基准
2. 选择 `<candidate-tag-1>`
3. 选择 `<candidate-tag-2>`

AionUi、AionCore 和 aionrs 的发布基准按产品分别选择。Ki-Buddy 规划还应把“保持当前 Ki-Core pin”与选择新的完整 Ki-Core Release 分开列出。等待管理员明确回复；不得把最高版本、发布时间最近或 SemVer 最大的版本当作默认选择。

管理员选择后只输出规划，包含：

- 目标仓库
- 当前发布基准与目标发布基准
- 预期 base branch
- 建议的维护分支名
- 预计修改文件
- 验证命令
- 已安装且适用于目标仓库的发布 skill：Ki-Buddy 使用 release-ki-buddy，Ki-Core 使用 release-ki-core，Ki-Model 读取其选定 clone 的 `.claude/skills/release-ki-model/SKILL.md`；不存在时写明“尚未提供写入入口”

保留当前发布基准时明确说明不需要上游同步 PR。选择新基准时明确说明后续需要独立同步 PR，但本次不创建 branch、worktree、commit、PR、tag 或 Release。

## 6. 恢复只读状态检查

用户提供 PR、Actions run 或 tag 时，不要求依赖之前的会话状态。

### PR

读取 PR 的 repository、base/head branch、head SHA、files、checks、review/merge 状态和评论。根据 PR 文件判断它是上游同步、Ki-Core/Ki-Model Release PR、Ki-Buddy 版本准备还是普通修复；不得仅凭标题判断。

### Actions run

读取 `status`、`conclusion`、`event`、`workflowName`、`headBranch`、`headSha`、attempt、jobs 和 URL。将 `headSha` 与 PR、tag 和版本映射交叉核对。只报告是否运行中、等待审批、失败或完成，不重跑。

### tag

解析 lightweight 或 annotated tag 到 commit，读取 Release 的 Draft/Prerelease 状态和资产，再使用该 commit 查询相关 workflow runs。将 tag commit 与 `product/main`、版本映射和 Release provenance 交叉核对。

裸编号可能同时匹配多个仓库时给出仓库选择并等待回复。恢复报告最后列出“已完成”“仍在等待”“失败证据”“允许的下一步”，但不执行下一步。

## 输出格式

1. 数据来源与检查时间
2. 仓库发现结果
3. 本次相关产品的当前版本、已发布基准与 pending 状态
4. AionUi / AionCore 上游候选版本（按目标适用）
5. aionrs 上游候选与 Ki-Model / Core 实际 SDK 来源（按目标适用）
6. 累计变化、资产、compare、changed paths 与兼容性信号
7. 管理员的编号选择，或恢复状态与允许的下一步
8. 只读确认：本次未创建或修改 branch、worktree、commit、PR、tag、Actions run 或 Release
