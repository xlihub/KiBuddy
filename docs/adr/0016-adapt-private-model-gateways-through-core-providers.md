---
status: accepted
---

# 通过 Ki-Model OpenAIProvider 和可选网关配置适配私有模型

当前决定（2026-09-11）：KiBuddy 在既有自定义 OpenAI 兼容模型入口增加可选模型网关配置；Ki-Core 负责配置、凭据、HTTP client 装配与统一 provider 创建；Ki-Model（aionrs fork）扩展 OpenAIProvider 并统一维护 Chat Completions 消息、工具和响应处理。该决定取代本文件下方的旧决定。

实际需求已明确为标准 Chat Completions 加特殊网关请求配置。Core 独立实现已出现与 SDK 的兼容差异；采用 SDK 扩展可以避免持续维护第二套消息和 SSE 实现，代价是协调三个仓库的接口、回归和固定依赖版本。Ki-Model 提供可由产品自行维护与发布的 SDK 来源。

## 当前决定的约束

- SDK 保留原构造入口和缺省行为，提供窄的可选请求头、鉴权与 client 配置；复用既有完整 URL/api_path 和 stream_options 能力，修复 data 冒号后可选空格等通用 SSE 行为。
- 模型协议与模型网关配置分别表达；不按客户地址或名称创建新 provider，不构建任意协议、请求体或脚本编辑器。自定义请求头名称受校验，凭据加密管理，项目默认值只属于项目预设。
- Ki-Core 保留统一创建与 Agent 注入入口，在 SDK 替换验证通过后删除独立协议实现；聊天、恢复和健康检查使用相同连接配置。旧连接没有高级设置时保留原行为。
- Ki-Core 的六个 aion-\* crate 统一引用 Ki-Model 同一固定 tag/commit，更新 Cargo.lock；先评估原 v0.2.11 基线与上游差异，不直接采用未经评估的主分支，不依赖临时 path/patch。客户无需独立安装 SDK。
- 离线验证覆盖真实 Core 工具往返、流式、错误、取消和重试；现场未知项保持待验证。项目包仍走 github-history，仅交付 Windows x64/ARM64 正式候选并由现场验收。
- 工单归属：Ki-Model #1 为 SDK，Ki-Core #21 为集成，其余 Core 工单负责 API/凭据/构建，KiBuddy 工单负责界面/预设/交付。扩展 ADR 0015 中的产品源码关系以包含独立 SDK fork，不改变桌面与服务端的既有所有权。

## Ki-Model 分支与发布策略（2026-09-11 确认，待实施）

Ki-Model 与 Ki-Core、KiBuddy 使用相同的 main / product/main 职责：main 跟踪上游，不承载产品提交；product/main 为默认产品开发与 PR base。通用桌面高级配置进入 KiBuddy product/main，客户预设位于 distribution/zxjt。

上游 aionrs 完整正式版本只形成候选；维护者选择确切 tag/peeled commit 后通过独立同步 PR 更新产品基准，可以跳过中间版本或保留原基准。main 的快进镜像更新与产品基准采用相互独立，不能让上游同步触发继承的发布 workflow。

Ki-Model 采用独立 SemVer、产品 CHANGELOG、ki-model-vX.Y.Z、Release Please 与 ki-model-stable 审批，产品版本不覆盖上游 Cargo workspace version。同步 PR 只记录待发布基准，Release PR 提升基准并追加不可变历史映射；发布后显式触发验证，已公开 tag 和资产不可覆盖。

Ki-Model #2 交付分支与上游同步治理，#1 在产品分支实现 SDK 扩展，#3 通过正式发布流程交付固定版本，随后 Core #21 集成。SDK、Core 和桌面版本分别由维护者选择，不自动升级下游；版本来源链包含 Ki-Model 与 aionrs。

本节记录已确认要求，未宣称远端分支、保护规则、workflow 或首版 Release 已部署。

## 旧决定（已被上述 SDK 扩展决定取代）

以下为先前方案的历史记录，不再作为本次实施或验收要求。

### 通过 Ki-Core 自定义 provider 适配客户模型网关

项目长期需要对接客户私有模型服务，其鉴权、网络策略和响应格式可能不同。Ki-Core 通过 aionrs 已公开的 `LlmProvider` 与 provider 注入入口维护协议适配，KiBuddy 负责项目模型预设和用户配置；本次中信接入保持 aionrs 源码与已锁定版本不变。模型协议适配类型按协议差异组织，多个客户可以共用，地址、模型和凭据不成为新增 provider 的理由；符合标准 OpenAI 协议的私有服务继续使用既有入口。

#### Considered Options

- 扩展 aionrs 内置 OpenAI provider：可以持续复用其解析和请求能力，但客户适配需要协调额外仓库的修改、版本与发布。本次优先让 Core 独立控制适配交付，因此不采用。
- 在 Core 实现自定义 provider：使用既有注入接口，保留 aionrs 的 Agent、工具执行与会话机制；接受 Core 自行维护请求转换、SSE、错误与重试，并在依赖升级时验证公开接口兼容性的成本。

#### Consequences

- 聊天、会话恢复和健康检查使用同一 provider 选择与创建入口，按显式配置选择，不根据客户名称、主机地址或模型字符串猜测。
- 通用服务端不包含客户地址、密钥或项目默认值。已存在的标准 provider 不受新适配影响；不复制每个客户一套 provider，也不建设任意协议编辑器。
- 本次由自定义 provider 正确读取现场 SSE，不修改 aionrs 的通用分帧实现，也不为此升级、patch 或 vendor aionrs。其现有问题可另行跟踪，不成为本次交付的前置条件。
- 自定义 provider 必须通过真实 Core 调用链的流式、工具往返和失败路径验证；不能以只注入成功或单次回答成功作为完成标准。
- 本次项目包仍按用户选定的 `github-history` 渠道构建和交付，不改变既有双 Windows 架构及现场验收要求。
