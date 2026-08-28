---
name: release-ki-buddy
description: 管理 Ki-Buddy 的发布维护写操作与监控，包括选择后的 AionUi 上游同步、已公开 Ki-Core 采用、Ki-Buddy 版本准备、tag、Actions、Draft Release 核验和 worktree 清理。仅用于 Ki-Buddy；只读状态检查和候选分析使用 ki-release-maintenance，Ki-Core 自身发布使用 release-ki-core。
---

# Ki-Buddy 发布维护

在管理员已经选择 AionUi 发布基准、Ki-Core Release 和 Ki-Buddy 目标版本后，执行 Ki-Buddy 同步与发布。把每个仓库或 GitHub 状态变更作为独立确认点，保留管理员对基准、版本、PR、tag、重试和内部 Release 的决定权。

## 权威资料

按任务分支读取以下文件：

- 开始使用维护领域术语前读取 `CONTEXT.md`，采用“上游候选版本”“发布基准”“独立发布节奏”。
- 发现仓库、建立四层映射、筛选完整候选版本或按 PR、Actions run、tag 恢复时读取 `.claude/skills/ki-release-maintenance/SKILL.md`。
- 解释管理员为何需要选择发布基准时读取 `docs/adr/0001-ki-independent-release-cadence.md`。
- 规划版本 PR、正式发布、资产检查、失败分类或重跑时读取 `docs/contributing/maintainer-release-and-maintenance-handbook.zh-CN.md`。
- 处理分支职责、同步 PR、映射、CHANGELOG、Ki-Core 消费或人工发布边界时读取 `docs/contributing/upstream-release-analysis-and-target-alignment.zh-CN.md`。
- 生成任何写操作的确认卡前，读取选定 Ki-Buddy clone 中的 `AGENTS.md`、发布配置、正式 workflow、产品映射验证器和资产验证器，以目标 commit 的实现确定命令、文件名、Environment、workflow/job 名称和资产契约。

管理员可见说明使用简体中文；命令、路径、API 名、tag、branch、workflow 和 label 保留原文。长期发布事实只写入现有版本映射、`CHANGELOG.ki-buddy.md`、已有 PR 评论和 GitHub Release provenance；不创建本地发布日志。需要追加恢复或核验记录时，在管理员确认后更新关联 PR 评论。

## 仓库和权限边界

仓库发现、身份归类和历史仓库判定以 `ki-release-maintenance` 的“发现 Ki 双仓”为唯一规则来源。写操作目标以当前 `ki-buddy-product.json` 的 `source.repository` 和 `internalRelease.repository` 为准；两个值不一致，或选定 clone 的规范化 remote 与它们不一致时停止。

本文中的“内部 Release”指 `internalRelease.repository` 中的 Ki-Buddy Release；`publicDistribution.repository` 只提供历史公开分发证据，不是本 skill 的写操作目标。

开始前执行只读检查：

1. 使用 `ki-release-maintenance` 的仓库发现规则选择唯一 Ki-Buddy clone，不自动 clone。
2. 读取并验证 `ki-buddy-product.json` 中的源码仓库与内部 Release 仓库，再与选定 clone 的规范化 remote 比较。
3. 读取 `git status --short --branch`、`git worktree list --porcelain`、remote、当前 branch 和 HEAD。
4. 检查 GitHub 认证，再用只读 API 验证当前账号对配置声明的源码仓库具有所需权限。认证或权限不足时停止写操作。
5. 读取远端 `product/main`、开放 PR、正式构建 runs、tag 和 Release，避免重复创建对象。

保持以下边界：

- 在每个 PR 对应的专用 git worktree 中准备本地变更。保留原工作树及其中未提交的修改，不执行 `stash`。
- 不覆盖、移动、删除或复用已经存在的 tag、已发布 Release 资产和历史映射。
- PR 合并或关闭前保留对应 worktree。清理 worktree 和删除 branch 分别取得管理员确认，不使用 `--force`。
- 不代替管理员批准 GitHub Environment，不调用审批 API，也不把聊天中的确认解释为 Environment approval。
- 不代替管理员将 Draft 发布为内部 Release，不调用 Release 发布 API。
- 检测到冲突、身份不一致、来源证据缺失、确定性失败或当前仓库无法表达所选映射时停止当前写入阶段。
- 行为改进以真实 PR、run、tag 和 Release 为依据；不为测试本 skill 创建模拟 PR、tag、Actions run 或 Release。

## 每次写操作的确认卡

任何改变本地文件、Git refs、GitHub 对象、Actions 状态或下载目录的命令执行前，输出确认卡并等待管理员明确回复。一次确认只授权卡片中的紧邻操作。

```text
目标仓库：<source.repository>（本地绝对路径）
base：product/main（远端 HEAD SHA）
branch：分支名；不适用时写“无”
当前映射：Ki-Buddy / AionUi tag+commit / Ki-Core tag+commit / AionCore tag+commit
目标映射：Ki-Buddy / AionUi tag+commit / Ki-Core tag+commit / AionCore tag+commit
当前 Ki-Buddy 版本：X.Y.Z
目标 Ki-Buddy 版本：X.Y.Z
预计修改内容：文件、ref、PR、run、Release、下载目录或 worktree 的精确清单
将执行的命令：完整命令及工作目录
确认选择：1. 执行本项  2. 停止
```

以下操作分别展示确认卡：下载资产、删除临时目录、`fetch`、创建 worktree/branch、合入 AionUi tag、编辑文件、commit、`just push`、创建 PR、更新 PR 评论、合并 PR、创建本地 tag、推送 tag、手工 dispatch workflow、重跑 workflow、移除 worktree 和删除 branch。只读查询可以合并执行。

命令、工作目录、SHA、branch、映射或修改清单在确认后发生变化时，原确认失效。不得用一次“确认整个发布”的回复连续执行多个阶段。

## 1. 恢复状态并取得管理员选择

用户提供 PR、Actions run 或 tag 时，先按 `ki-release-maintenance` 的恢复规则重建状态，不依赖之前的会话。识别 repository、base/head、head SHA、四层映射、关联 workflow 和 Release 后，从尚未完成的第一个阶段继续。

开始新发布时先展示证据，再要求管理员分别选择：

1. 发布规划：
   1. 保持当前 AionUi 发布基准和 Ki-Core pin。
   2. 更新 AionUi，保持当前 Ki-Core pin。
   3. 保持当前 AionUi 发布基准，采用新的 Ki-Core。
   4. 同时更新 AionUi 与 Ki-Core。
2. AionUi 发布基准：保留当前基准，或选择一个经过完整性核验的正式 AionUi Release。
3. Ki-Core pin：保留当前 pin，或选择一个经过核验、已经公开的正式 Ki-Core Release。
4. Ki-Buddy 目标版本：管理员给出的稳定 SemVer `X.Y.Z`。

四项都等待管理员明确选择。可以按未发布的 Ki-Buddy `feat`、`fix`、`perf`、breaking change 和纯基准更新提供 SemVer 建议及证据，但不设置默认选项，不替管理员选择最高版本或最新发布时间。

校验目标 Ki-Buddy 版本：

- 高于最近已发布的 Ki-Buddy 产品版本；内部 Release 与历史公开分发证据分别核对。
- `ki-buddy-vX.Y.Z` 在本地和远端均不存在。
- 没有同版本的内部 Release、历史公开 Release、开放版本准备 PR 或已失败且保留的 tag。
- 与管理员输入完全一致。

如果管理员保留两个基准，只在 `product/main` 相对最近已发布的 Ki-Buddy 产品 tag 存在可发布变化时继续。没有可发布变化时停止。

## 2. 核验两个发布基准

### 2.1 AionUi

只把 `ki-release-maintenance` 列出的完整 AionUi Release 提供给管理员。对选定 Release 再核验：

1. Release 已公开，`isDraft=false`、`isPrerelease=false` 且 `publishedAt` 非空。
2. tag 解析到完整 commit SHA，commit 与 Release provenance 和目标 workflow 的 `headSha` 一致。
3. 正式发布 workflow 已成功完成。
4. 从目标 tag 内的 workflow 和资产验证脚本读取该版本的资产契约，Release 满足该契约。
5. compare 范围从当前 AionUi 发布基准到选定 tag，不包含 tag 之后的提交。

任一项缺失时把该版本标为“尚不完整”，停止同步。不要使用当前默认分支的资产规则代替目标 tag 的规则。

### 2.2 Ki-Core

采用新的 Ki-Core 时只接受已经公开并通过自动资产核验的 Release。重新核验：

1. Release 已公开，非 Draft、非 Prerelease，tag 与 release commit 一致。
2. 正式 workflow 对同一 tag 和 commit 成功完成。
3. 目标 tag 的契约包含 macOS x64/arm64、Linux x64/arm64、Windows x64/arm64 六类 archive 和 checksums，Release 全部具备。
4. checksums 恰好覆盖六类 archive；经管理员确认后下载到新建临时目录并验证实际字节。
5. Ki-Core version、tag、commit 与其 AionCore tag、peeled commit、公开 Release provenance 相互一致。

任一项不成立时停止采用。Candidate Build、Actions artifact、`latest`、未公开 Release 或其他 commit 的资产不得作为正式 pin。

## 3. 读取目标仓库的发布契约

在创建 PR 前从选定 Ki-Buddy clone 读取并记录：

- `ki-buddy-version.txt`、`ki-buddy-release.json`、`ki-buddy-product.json` 和 `CHANGELOG.ki-buddy.md` 的字段与一致性规则。
- 根 `package.json` 与映射的 AionUi commit 保持 byte-identical 的要求。
- 产品配置中 Ki-Core tag、release commit、AionCore 映射和六平台 checksums 的 pin 规则。
- `packages/shared-scripts/src/kiBuddyRelease.js` 或当前等价验证器提供的结构校验、Git 历史校验、Release Notes 生成命令。
- `.github/workflows/build-and-release.yml`、复用 workflow、Web CLI workflow 和资产验证脚本提供的 CI、平台矩阵、Environment、Draft Release 和 provenance 契约。

如果当前验证器无法在独立同步 PR 与版本准备 PR 之间保持确定一致状态，不改写已经发布的映射，也不临时关闭验证器。报告缺少的状态转换，要求先用普通修复 PR 调整发布状态机，之后重新开始发布。

## 4. 准备独立同步 PR

任何同步或兼容性 PR 必须先合并并通过验证，随后才能创建版本准备 PR。每个 PR 使用从最新 `origin/product/main` SHA 创建的专用 worktree。

### 4.1 AionUi 上游同步 PR

仅在管理员选择新的 AionUi 发布基准时执行：

1. 分别确认获取 `origin/product/main`，并从经过核验的官方 `iOfficeAI/AionUi` remote 获取选定 AionUi tag 的精确 ref。不得假设该 tag 存在于 Ki-Buddy `origin`；获取后重新解析 tag 并与候选报告中的完整 commit SHA 比较。
2. 确认从已验证的 `origin/product/main` SHA 创建 branch 和专用 worktree。建议 branch 为 `fix/sync-aionui-<tag>`。
3. 确认以 `--no-commit --no-ff` 合入选定 tag 解析出的 commit。合并对象必须等于确认卡中的完整 SHA。

出现冲突时保留 merge 状态和 worktree，输出冲突文件、base、tag、commit 和已执行命令，转交 `/resolving-merge-conflicts`。冲突解决并通过受影响测试前不 commit、不 push、不创建 PR。

无冲突时保留 Ki-Buddy 产品配置、发布 workflow、产品 CHANGELOG 和定制行为；根 `package.json` 与目标 AionUi commit 保持 byte-identical，根 `CHANGELOG.md` 保持 AionUi 上游内容。确认 diff 只包含选定 tag 以内的上游累计变化和为保留 Ki-Buddy 定制所需的适配。

### 4.2 Ki-Core 依赖兼容 PR

采用新的 Ki-Core 时先检查从当前 pin 到目标 Release 的 API、协议、migration、bundle manifest 和平台差异。只有存在可独立合并的 Ki-Buddy 兼容代码、测试或构建适配时才创建依赖兼容 PR；该 PR 不提前改写 Ki-Buddy 版本、当前四层发布映射或正式 pin。

使用管理员确认下载的目标 Ki-Core Release 资产进行受控验证。提交前移除临时测试输入，确认 diff 不包含下载资产、临时 pin 或本地日志。没有兼容性修改时报告“不需要依赖兼容 PR”，把正式 pin 和四层映射更新留给版本准备 PR。

如果兼容性修改只有在提前改变正式 pin 或已发布映射后才能通过，停止并按第 3 节报告发布状态机缺口，不创建已知无法通过 CI 的 PR。

### 4.3 验证、提交和合并

对每个同步或兼容性 PR：

1. 运行目标仓库要求的产品映射校验、确定性检查、受影响测试、格式、lint、typecheck 和完整 workspace 测试。
2. 按“每次写操作的确认卡”依次处理 commit、`just push` 和创建 PR。PR base 固定为 `product/main`。
3. PR 正文记录当前/目标基准、完整 SHA、compare、changed paths、兼容性信号、实际验证命令和后续版本准备范围。
4. 读取 PR 返回的 number、head SHA、URL 和 required checks。head SHA 或 base 改变后重新核验。
5. required checks 全部成功后固定已验证 head SHA，再按确认卡规则处理 PR 合并。

存在 AionUi 同步和 Ki-Core 兼容两个 PR 时分别审查、合并，不把它们与版本准备内容组合成一个 PR。

## 5. 准备 Ki-Buddy 版本 PR

所有需要的同步或兼容 PR 合并后，从新的 `origin/product/main` SHA 创建另一个 branch 和专用 worktree。建议 branch 为 `release/ki-buddy-X.Y.Z`。

版本准备只包含本次发布所需内容：

- `ki-buddy-version.txt`：管理员选择的 Ki-Buddy 独立版本。
- `ki-buddy-release.json`：当前待发布版本的四层映射，即 Ki-Buddy、AionUi、Ki-Core、AionCore 的 version/tag/完整 commit。
- `ki-buddy-product.json`：产品身份保持不变，正式 Ki-Core pin、AionCore 映射和六平台 checksums 与目标 Ki-Core Release 一致。
- `CHANGELOG.ki-buddy.md`：新增目标版本条目，分别包含“Ki-Buddy 定制变化”“AionUi 上游更新”“Ki-Core 更新”；保持当前基准或 pin 时明确写明本版本未更新。
- 根 `package.json`：不写入 Ki-Buddy 产品版本或品牌字段，与目标 AionUi commit 保持 byte-identical。

CHANGELOG 只收集从最近已发布的 Ki-Buddy 产品 tag 到目标 release commit 的用户可见变化和必要发布说明。分别记录 Ki 定制、AionUi 累计变化、Ki-Core/AionCore 版本与 compare；不把纯格式、普通依赖整理或 workflow 调试写成产品能力。

运行并记录目标仓库当前要求的：

1. 四层映射和产品配置结构校验。
2. AionUi tag/commit 与根 `package.json` 的确定性校验。
3. Ki-Core Release pin、六平台 checksums、archive 和 provenance 校验。
4. 格式、lint、typecheck、i18n（适用时）、受影响测试和完整 workspace 测试。

任何失败都停止。后续 commit、`just push`、创建 PR 和合并 PR 按确认卡列表逐项处理。PR 正文列出四层当前映射与目标映射、三个 CHANGELOG 来源、验证命令和结果。合并时使用已验证 head SHA；管理员确认后 head SHA 变化则重新确认。

## 6. 分别确认 tag 与正式构建

版本 PR 合并后读取远端 `product/main` release commit。先核验该 commit 上的版本文件、四层映射、产品配置、CHANGELOG 和全部确定性检查，再进行以下独立操作：

1. 确认获取精确 `origin/product/main` 和 tag refs。
2. 确认远端不存在 `ki-buddy-vX.Y.Z`。
3. 按确认卡规则在已验证 release commit 上创建本地 tag。
4. 重新核验 tag commit 后，以新的确认卡处理 `just push origin refs/tags/ki-buddy-vX.Y.Z`。

不得让 tag 指向 branch 名、未验证的本地 HEAD 或版本 PR head。tag 已存在时解析其 commit 并进入恢复流程，不移动、删除或重建。

tag 推送后确认正式 workflow 的 repository、workflow、event、tag、head SHA 与 release commit 一致。持续监控到运行成功、确定失败、等待 Environment 审批或管理员停止，不以固定等待时间或单个平台耗时推断失败。

## 7. Environment 与 Draft Release

所有前置 job 成功后，正式 workflow 应等待目标 commit 中声明的发布 Environment。展示 repository、workflow、run ID、URL、tag、commit 和四层映射，要求管理员在 GitHub Environment 页面亲自批准。

审批后继续监控，确认 workflow 为同一 tag 和 commit 创建 Draft Release。管理员负责检查并手工将 Draft 发布为内部 Release；skill 只读取 Draft 状态、Release Notes 和资产，不执行发布操作。

管理员发布后重新读取内部 Release，不能把 Draft、Prerelease 或仍在上传资产的页面报告为完成。

## 8. 恢复、失败和重试

恢复输入支持：

- PR：读取 repository、files、base/head SHA、checks、评论和 merge 状态，根据文件判断 PR 阶段。
- Actions run：读取 workflow、attempt、event、headBranch、headSha、jobs、status、conclusion 和 URL。
- tag：解析 lightweight 或 annotated tag 到 commit，读取同 commit 的 runs、Release 和四层映射。

失败分类：

| 分类       | 证据                                                             | 允许的下一步                                      |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| 瞬时失败   | 网络、GitHub API、runner 临时故障；代码、配置和映射无需变化      | 同一 tag、commit、workflow 在单独确认后重跑       |
| 确定性失败 | 编译、测试、映射、lockfile、权限配置或资产规则需要代码/配置变化  | 普通修复 PR，并使用新的 Ki-Buddy patch 版本和 tag |
| 证据不足   | 查询失败、日志缺失或无法证明 tag、commit、workflow、attempt 身份 | 重新读取证据，不重跑                              |

重跑前重新读取原 run、当前 tag 和 workflow，确认 tag、commit、workflow 三者与失败 attempt 完全相同，再按确认卡规则处理相同 run 的重试。不得为不同 commit 复用 tag，不手工替换部分资产，不覆盖已发布 Release 的来源。

## 9. 完成核验

同时满足以下条件才报告 Ki-Buddy 发布完成：

1. `ki-buddy-vX.Y.Z` 解析到已确认的 release commit，且该 commit 位于 `product/main`。
2. 内部 Release 已由管理员发布，非 Draft、非 Prerelease，tag 和 commit 一致。
3. 正式 workflow 对同一 tag 和 commit 成功完成，包含代码质量、六类桌面构建、五类 Web CLI 构建和安装冒烟测试。
4. 从目标 tag 的 workflow 和资产验证脚本重新取得资产契约，自动核验六个桌面构建类别、五个 Web CLI archive 与各自 SHA-256、安装脚本，以及六类 updater metadata。桌面类别可能产生多个发布文件；当前契约的六个类别产生八个桌面文件，按目标 tag 的实际契约核验全部文件，不按类别抽样。
5. updater metadata 的版本、路径和内含 checksum 指向同一 Release 中的对应桌面资产；六份 metadata 全部核验。
6. 经确认后下载目标 tag 资产验证脚本要求的全部资产，不使用代表性样本。运行目标 tag 的验证器，校验所有 checksums 与实际字节；对六个桌面类别和五个 Web CLI 类别逐类检查产物内的 bundle provenance，核对 Ki-Buddy、AionUi、Ki-Core、AionCore 四层身份和 `release-pinned` 来源。
7. `ki-buddy-version.txt`、`ki-buddy-release.json`、`ki-buddy-product.json`、`CHANGELOG.ki-buddy.md`、tag、Release Notes 和 GitHub Release provenance 相互一致；存在关联 PR 评论时一并核对。

这里的内部 Release provenance 包含不可变 tag 及其 commit、创建该 Release 的 workflow run/attempt/head SHA、`publishedAt`、完整资产清单，以及资产内的 bundle provenance。缺少下载确认时可以报告发布状态和名称契约已通过，但把实际字节、metadata 内容和 bundle provenance 标为“尚未验证”，不得报告发布完成。

人工安装测试可以另行记录，不属于完成条件。报告数据来源、检查时间、PR、run、tag、Release URL、资产核验、四层映射、provenance 和无法验证的字段。

## 10. 清理专用 worktree

只有对应 PR 已合并或关闭且 worktree 没有需要保留的修改时，才提供选择：

1. 保留 worktree，稍后处理。
2. 移除明确绝对路径的 worktree。

管理员选择移除后，按确认卡规则运行针对该路径的 `git worktree remove`。branch 删除属于确认卡列表中的另一个写操作。worktree 有修改时报告文件并停止。
