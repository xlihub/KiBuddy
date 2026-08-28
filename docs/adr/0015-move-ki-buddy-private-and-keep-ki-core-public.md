---
status: accepted
---

# 将 KiBuddy 迁移为 private 并保留 Ki-Core public fork

Ki-Buddy 需要继续跟随 public `iOfficeAI/AionUi`，但通用桌面产品源码和项目分发分支不再适合公开维护。Ki-Buddy 源码将迁移到名为 `KiBuddy` 的 standalone private repository，并保留完整 Git 历史；该仓库不属于 AionUi fork network，`main` 继续映射 AionUi upstream，`product/main` 保存通用 Ki-Buddy 产品，访问边界相同的项目使用 `distribution/<distributionId>` 分支，访问边界不同的项目使用独立 private repository。

`xlihub/Ki-Core` 继续保持 public fork，不迁移为 private `KiCore`，也不与 KiBuddy 组成 monorepo、submodule 或 subtree。Ki-Core 保留当前独立 `main`、`product/main`、SemVer、tag、Release Please、Release、AionCore 基准选择和发布节奏。private KiBuddy 继续通过公开且不可变的 Ki-Core tag、commit、AionCore 映射和 checksum 固定服务端来源，不增加跨仓只读认证。

现有 public fork `xlihub/Ki-Buddy` 在迁移完成后 archive，暂不删除，也不发布迁移 updater 的桥接版本。private `KiBuddy` 延续当前 Ki-Buddy SemVer，迁移后的下一个正式版本是 `0.1.8`，不重置版本线或复用历史版本号。现有用户如何迁移、公开安装包如何进入自建 OSS/CDN、内部 GitHub Release 如何作为来源证据，以及签名和 auto updater 如何工作，均作为后续独立设计；本决定不要求当前实现改动这些链路。

KiBuddy 安装包只内置从 Ki-Core Release 或 candidate artifact 验证得到的二进制和 managed resources，不内置 Ki-Core 源码。Ki-Core 仓库及源码仍然公开，随包 provenance 也保留 `xlihub/Ki-Core`、版本、tag、commit 和来源策略，不能把二进制打包表述为隐藏或私有化 Ki-Core 来源。

## Considered Options

- 同时把 Ki-Core 迁移为 standalone private `KiCore`：源码边界一致，但 private KiBuddy 的正式发布、Manual Build 和项目分发都需要跨仓读取 Release 与 Actions artifact，并引入新的凭据和不受信任分支隔离问题。
- 建立单一 private monorepo：可以在一个 commit 中修改客户端和服务端，但会破坏两套独立上游历史、版本和发布流程，并让 `main` 无法直接映射两个 upstream。
- 由 `KiBuddy` 通过 submodule 或 subtree 包含 Ki-Core：保留了一部分历史边界，但给 checkout、Actions 权限和上游同步增加额外状态，而当前固定 Ki-Core Release 已经提供稳定组合关系。
- 保持 Ki-Buddy public fork：可以继续使用 GitHub fork 关系，但通用桌面产品源码和项目分发代码会继续公开。

## Consequences

- KiBuddy 上游同步通过显式 AionUi upstream remote、固定基准和同步 PR 完成，不再依赖 public fork 的可见性关系。
- Ki-Core 继续使用现有 public fork 流程；新的 AionCore 或 Ki-Core Release 只形成候选，不自动触发 KiBuddy 更新或发布。
- KiBuddy 的正式和手工构建继续匿名读取 public Ki-Core Release、checksums、workflow run 和 candidate artifact，不建设 GitHub App 或 PAT 跨仓认证。
- 安装包不包含 Ki-Core 源码，但公开来源会出现在仓库、发布映射、bundle manifest 和支持诊断中，这是有意保留的 provenance，不是源码泄漏。
- public `Ki-Buddy` archive 后保留历史源码、tag、Release 和问题记录；是否删除需要另一个明确决定。
- 自建公开分发源、签名和更新迁移是已确定的架构方向，但其凭据、存储结构、发布顺序、客户端兼容和平台验收不属于本 ADR 的实现范围。
