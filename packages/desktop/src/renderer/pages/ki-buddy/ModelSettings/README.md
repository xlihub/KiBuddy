# Ki-Buddy 自定义模型与项目预设

对应 KiBuddy #30–#33。用户要求手动开关关闭时保留 AionUi 自定义模型表单，开启时完全使用 Ki-Buddy 手动表单；后续确认接入 Core 已提交的契约。

## 已核对的契约

- Ki-Core：`github-history/feat/openai-connection-options`，`99387e444746bfe95f8adcb816fd2ab44513d21d`，`crates/aionui-api-types/src/provider_gateway.rs`、`provider.rs` 与 `crates/aionui-system/src/provider_gateway.rs`。
- Ki-Model：`ki-model-v0.1.1` / `6e9a710738fac4e76d03d936c0c69d26cec96157`。Core 统一构建 SDK OpenAIProvider；桌面不解析模型协议或 SSE。
- 保存沿用既有 provider API 和认证 IPC。`model_mode=manual`、`is_full_url=true`、完整地址与请求模型 ID 原样保留，固定 Chat Completions。三个弹窗在手动模式停止发现、协议探测和地址修正。Bearer、代理及 stream_options 的 Select 使用普通容器与 aria-label，避免外层 label 额外触发点击而使下拉立即关闭；回归测试通过显示值和可交互选项进行真实点击。
- `gateway` 为整体替换；更新缺省/null 保留。回到自动配置显式发送 `model_mode=automatic`，已有网关通过 `clear_gateway=true` 清除，使用自动表单填写的 API Key。若已存请求头凭据，切换开关不会直接授权删除；必须点击独立的确认清除操作后才能保存。
- `auth=bearer|none`；Bearer 使用既有 API Key。关闭 Bearer 不发送它，保留草稿中的已有 Key 便于重新开启，关闭 Bearer 后可使用独立“清除已存 API Key”按钮，确认保存才删除。仅请求头鉴权不要求 Key。
- `proxy=default|direct`，default 为 reqwest 默认代理发现，不承诺所有系统 PAC 设置。该策略仅影响当前连接。
- `include_stream_options` 缺省采用 SDK 默认发送行为。
- 界面使用秒、最多三位小数；API 使用整数毫秒。连接范围 0.001–300 秒，默认 10 秒；读取及单次请求范围 0.001–3600 秒，读取默认 30 秒，总请求默认不限。

## 请求头凭据

新增头默认作为加密凭据，也可显式选择普通值。敏感头元数据只有名称和配置状态，读取时没有明文值；界面支持保留、替换、清除。重命名为不同名称需要重新填写，不将旧凭据套用到新名称。大小写变化保留原凭据。

`kiBuddyProviderAdapter` 将 `header_credentials` 写入暂存的 WeakMap；它只在已有 IPC 保存边界组成请求，不进入可序列化 provider、乐观查询缓存或会话模型对象。失败时保留请求以便重试，成功后删除暂存。通用 HTTP 日志对 credential 容器统一脱敏。

清除凭据会保留对应头的未配置状态；Core 在发起网络请求前明确拒绝使用。删除头会删除其凭据。普通设置修改不会删除已有凭据。校验覆盖 Core 的传输保留头、大小写重复、Authorization/Bearer 冲突、控制字符、长度及掩码占位；错误不回显输入值。

## 项目预设与升级

受信注册的 `nonSensitiveConfigKeys` 允许 `modelPreset`；项目默认值写在 `distribution/zxjt` 派生分支的 `distribution-manifest.json`，不进入公共入口。模型预设运行时类型、严格验证和 capability 投影由产品 common 模块拥有。配置包含稳定 id、名称、完整 endpoint、modelIds、headerNames、manual、protocol、bearer、proxy、streamOptions，不接受凭据字段。

模型设置页读取已认证 provider 列表后初始化预设：稳定 provider id 防止重复创建，安装数据目录中的初始化标记保留升级与主动删除行为。初始化失败可重试；已有稳定 id 或匹配旧预设的连接会被保留。项目正式/预览安装身份、Core 数据目录、系统凭据 namespace 继续沿用受信注册定义，local 身份不变。

恢复项目默认仅改变非敏感地址、模型与网络选项。API Key、已有敏感头、额外敏感头及其凭据操作均保留；新增预设头保持未配置，需要用户填写。界面明确提示项目默认值仍待现场验证。恢复不会触发自动保存，用户确认后才调用 Core。

## 验证方式与范围

- `modelDialogs.dom.test.tsx` / `modelSettingsAdapter.dom.test.tsx`：真实三个弹窗的手动/自动互斥、独立草稿、迟到探测响应、取消重开、capability 缺失和校验。
- `providerWire.dom.test.ts` / `modelPreset.dom.test.ts`：真实产品映射、失败重试、凭据不进入缓存、Core 边界、初始化并发、升级和恢复。
- `coreIntegration.dom.test.tsx`：显式指定本地 Core 二进制后启动隔离数据库与本地 HTTP 模拟服务，实际操作桌面表单，通过真实 HTTP bridge 保存。覆盖健康检查、聊天、受控 Read 工具往返、Core 重启、保留/替换/清除、Bearer、stream_options、读取超时以及受控代理与直连差异。默认完整单元测试跳过这个需显式二进制的套件。

```bash
KI_BUDDY_CORE_BINARY=/absolute/path/to/aioncore bun run test -- tests/unit/renderer/components/settings/KiBuddyModelSettings/coreIntegration.dom.test.tsx
```

离线验证不代表客户网络、Windows 安装或正式交付验收。此功能分支的本地源码包可以采用 development/local-binary 来源；正式产品 pin、candidate、发布和交付记录按已有发布流程另行处理，不伪造 provenance。

## 本次变更分类

固定本次起点：`e9f8421efc00e93c4089f5a30a4bdd9212de5575`；AionUi 基线 `1afdf95c187f24198ab502a3c86cb2ef40bc3c6f`。

| 文件 / hunk                                                      | 所有权        | 类型                | 职责或上游原行为                                           | 验证                          |
| ---------------------------------------------------------------- | ------------- | ------------------- | ---------------------------------------------------------- | ----------------------------- |
| `ModelSettings/index.tsx`                                        | 产品          | 产品实现            | 装配真实 adapter、独立手动提交和预设恢复                   | dialogs、live                 |
| `ModelSettings/types.ts`                                         | 产品          | 产品实现            | 表单值与凭据操作类型                                       | typecheck                     |
| `ModelSettings/kiBuddyProviderAdapter.ts`                        | 产品          | 产品实现            | Core 映射、请求专有凭据生命周期、保存                      | wire、live                    |
| `ModelSettings/KiBuddyModelSettingsFields.tsx`                   | 产品          | 产品实现            | 手动表单、预设提示与恢复                                   | dialogs、live                 |
| `ModelSettings/KiBuddyGatewayFields.tsx`                         | 产品          | 产品实现            | 代理、超时与 stream_options 控件                           | dialogs、live                 |
| `ModelSettings/KiBuddyGatewayHeaderFields.tsx`                   | 产品          | 产品实现            | 普通头和加密凭据交互                                       | dialogs、wire                 |
| `ModelSettings/kiBuddyGatewayValidation.ts`                      | 产品          | 产品实现            | Core 校验与脱敏错误键                                      | adapter、wire                 |
| `ModelSettings/kiBuddyModelPreset.ts`                            | 产品          | 产品实现            | 首次初始化、升级保留与恢复                                 | preset、live                  |
| `ModelSettings/KiBuddyModelPresetInitialization.tsx`             | 产品          | 产品实现            | 已认证查询后的初始化与错误重试                             | preset、full                  |
| `common/platform/ki-buddy/productConfig.ts`                      | 产品          | 产品实现            | 严格验证非敏感预设                                         | preset、product config        |
| `common/platform/ki-buddy/productCapability.ts`                  | 产品          | 产品实现            | 投影已校验预设                                             | capability/runtime            |
| `common/types/platform/kiBuddyProduct.ts`                        | 产品          | 产品实现            | 可序列化 capability 类型                                   | typecheck                     |
| `renderer/services/runtime/kiBuddyRuntime.ts`                    | 产品          | 产品实现            | 单一入口读取预设                                           | runtime                       |
| `ModelModalContent.tsx` persistence / mount                      | 上游          | 集成接缝            | 转发产品保存、挂载预设初始化；旧路径为既有 IPC             | wire/live、无 capability 测试 |
| `ModelModalContent.tsx` callbacks                                | 上游          | 通用改进            | 返回异步保存结果，失败时弹窗不关闭；错误日志不输出敏感请求 | dialogs                       |
| `AddPlatformModal.tsx`、`EditModeModal.tsx`、`AddModelModal.tsx` | 上游          | 通用改进 / 集成接缝 | 等待异步保存成功后关闭；转发产品提交                       | dialogs、live                 |
| `common/adapter/httpBridge.ts`                                   | 上游          | 通用改进            | 日志增加对任意 credential 容器的脱敏                       | httpBridge                    |
| `distributions/registry.json`                                    | 产品          | 配置 / 分发支撑     | 受信项目预设键授权                                         | projectDistribution           |
| `tests/unit/build-scripts/kiBuddyZxjtMockTest.py`                | 产品          | 支撑材料            | 等待请求日志实际写完后读取，修复全量并发测试暴露的时序问题 | mock HTTP 测试                |
| 测试、各语言 settings 资源、生成 i18n 类型和本说明               | 对应产品/上游 | 支撑材料            | 支撑上述行为与文本                                         | Vitest / i18n                 |
