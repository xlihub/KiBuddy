---
status: accepted
---

# 以注册记录和受保护分支治理项目分发

Ki-Buddy 需要从长期维护的项目源码生成专属安装包，同时避免把项目配置、安装身份和交付证据混入通用产品发布。每个项目使用不可变且不含敏感信息的 `distributionId`，在对应的 `distribution/<distributionId>` 受保护分支上维护项目代码、资源和分发清单，并使用独立 SemVer、安装身份、数据与凭据 namespace。当前可交付身份模式只有 `local` 和 `agents`；`external` 只保留为远期架构方向，不进入当前 schema 或构建入口。

`product/main` 中的项目注册记录负责批准 `distributionId`、不可变身份、生命周期和允许范围，项目分支中的分发清单负责声明该版本采用的非敏感配置。正式构建同时验证当前注册记录和固定源码 SHA 中的分发清单，冲突时拒绝构建并记录两份来源；项目分支通过选择并合并明确的 `product/main` 基准更新通用能力，首次正式交付后不 rebase、不 force push。

项目构建使用独立于现有通用 Manual Build 的受信任 workflow。预览构建可以使用未合并项目源码，但不获得受保护密钥并使用独立预览安装身份；正式构建只接受已经进入对应受保护项目分支的精确 SHA，只获得该 `distributionId` 的构建密钥。现有签名行为保持不变，本 ADR 不增加签名门禁，也不建设 OSS/CDN、GitHub Release 或 auto updater 的实际链路；项目分发当前只承诺手动交付。

一个项目版本可以串行产生多个交付候选 attempt。失败的 workflow run 不产生候选；每个成功候选保存独立来源与 checksum，管理员完成真实安装验收并确认持久交付副本后，才提交项目交付记录并创建受保护的 `distribution/<distributionId>/v<version>` tag。交付确认后的版本和产物不可替换；安装包遗失时发布新 patch，不能重新构建后冒充原产物。`retired` 项目停止新构建、撤销构建密钥并将分发分支转为只读，但保留交付证据和已有持久副本，也不远程停用已安装客户端。

## Considered Options

- 继续使用现有 Manual Build 的任意 branch 输入和 `secrets: inherit`：改动较少，但 mutable ref、跨项目密钥暴露和通用安装身份无法形成可信的项目交付边界。
- 为每个项目复制一套 workflow 和完整产品配置：短期直接，但规则会分散，项目之间容易出现身份碰撞和质量门槛漂移。
- 每个项目建立完全独立产品仓库和 runtime：隔离最强，但会重复维护 Ki-Buddy 通用能力；只有项目访问边界不同时才需要独立仓库。
- 只保存 workflow artifact 并在过期后重建：无法证明重新生成的字节与已交付安装包一致。

## Consequences

- 项目清单中的任何代码、资源或运行配置变化都产生新的项目版本；endpoint、client ID 等非敏感配置可以随包发布，token、client secret 和私钥不能进入 Git 历史或安装包。
- 同一项目版本一次只运行一个正式构建；候选被拒绝后可以产生新的 attempt，只有最终确认的 attempt 固定版本。
- Actions artifact 只是临时候选。确认交付前，项目负责人必须形成与 checksum 一致的持久交付副本，并在交付记录中保存保管引用。
- `active`、`suspended`、`retired` 只表示新构建授权，不构成已安装客户端的远程控制状态；`distributionId` 在退役后仍不可复用。
- 正式构建选择的平台必须全部通过同一固定源码和清单的验证；部分平台成功不能形成该次正式交付候选。
