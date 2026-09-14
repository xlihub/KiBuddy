# KiBuddy 模型设置前端适配

对应 [KiBuddy #30](https://github.com/xlihub/KiBuddy/issues/30)。本次范围经用户明确调整为：界面、产品适配接口及 mock 行为测试；真实 API 映射待 [Ki-Core #22](https://github.com/xlihub/Ki-Core/issues/22) 契约确定。

## 当前行为

既有自定义 OpenAI 兼容模型入口支持手动模式和可选网关设置。首次添加、编辑连接和后续添加模型共用 `useKiBuddyModelSettings`；只有显式 KiBuddy product capability 且 platform 为 `custom` 时启用产品行为。

关闭手动配置时，完整使用 AionUi 原有自定义表单和保存流程。开启后卸载原有表单，由产品组件提供独立的连接名称、完整聊天请求地址、按鉴权方式填写的 API Key 和请求模型 ID 输入（每行一个，无下拉发现）。高级网关设置仅在手动模式显示并参与保存。手动模式停止前端模型发现、协议探测及 URL 自动修正，并使用 Chat Completions；不按主机、客户名称或模型 ID 推断协议。

自动与手动模式分别维护草稿；切换模式不复制地址、凭据或模型。返回自动模式恢复原有自动草稿，不对手动输入的地址发起发现。手动提交直接经过产品校验和 adapter，不经过自动表单的必填 API Key、多密钥轮询、模型选择或视觉自动识别逻辑。添加模型入口继承连接模式，以纯文本填写请求 ID；编辑已有模型时保持 ID 不变。已保存的手动连接关闭手动模式时同时退出其完整 URL 模式，恢复自动发现；原本独立启用完整 URL 的普通连接保留原设置。取消编辑后重新打开会恢复已保存配置，不对取消的地址发起发现请求。

手动配置匹配已发布的 [Ki-Model 0.1.1](https://github.com/xlihub/Ki-Model/releases/tag/ki-model-v0.1.1)，源码 commit 为 `6e9a710738fac4e76d03d936c0c69d26cec96157`。依据该 tag 下的 [SDK 网关说明](https://github.com/xlihub/Ki-Model/blob/ki-model-v0.1.1/docs/ki-model/openai-gateway.md)及 `crates/aion-providers/src/openai_options.rs`：

| 产品编辑值                      | SDK 0.1.1 语义                                    | 前端行为                                                                                                |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `gateway.bearer` 未指定 / true  | `OpenAIAuth::Bearer`，默认值                      | 要求非空 API Key，拒绝非法头字符                                                                        |
| `gateway.bearer: false`         | `OpenAIAuth::None`                                | 不要求、不传递 API Key；允许自定义 Authorization                                                        |
| `gateway.headers`               | `OpenAIOptions.headers` 有序名称/值列表           | 值默认遮蔽；拒绝大小写不敏感重复、非法名称/值、传输层保留头及 Bearer/Authorization 冲突；错误不回显输入 |
| `gateway.proxy`                 | 调用方构造 `OpenAIOptions.client`                 | 未指定保持 SDK 默认网络策略；提供系统代理与直连选择                                                     |
| `gateway.connectTimeoutSeconds` | `ClientBuilder.connect_timeout`                   | 连接建立含 TLS；留空不设时限                                                                            |
| `gateway.readTimeoutSeconds`    | `ClientBuilder.read_timeout`                      | 每次成功读取后重置；留空不设时限                                                                        |
| `gateway.totalTimeoutSeconds`   | `ClientBuilder.timeout`                           | 单次请求至响应体结束，包含流式；不是跨重试总预算；留空不设时限                                          |
| `gateway.streamOptions`         | `ProviderCompat.transport.include_stream_options` | SDK 默认 true；false 时省略字段                                                                         |
| 完整聊天请求地址                | `ProviderCompat.transport.api_path: Some("")`     | 原样保留完整地址、查询参数和末尾斜线；本工单固定 Chat Completions                                       |

超时编辑值为非负有限秒数，支持小数及 0，最终 Duration 转换和持久化约束由 Core 契约确认。SDK 支持的 Responses、TLS/client 扩展及重试策略不因此增加到本次产品表单。

这些属性仍是产品编辑值，不是 Core wire 字段。Core #22/#23/#24 的序列化、加密存储、已保存凭据的替换/清除语义和能力识别仍待联调。新增头值只保存在当前弹窗内存，取消后丢弃；没有通过旧 IPC、localStorage 或日志发送真实头值。mock adapter 的测试元数据不能用于生产。

当前生产环境没有注册 adapter。普通自动配置继续调用原有保存流程；启用手动模式后，保存会显示未保存提示并保留弹窗。没有把 UI 值发给旧 Core，也没有使用本地 storage 模拟服务端保存。

## 后续 Core 集成位置

`KiBuddyModelSettingsAdapterContext` 提供两个纯映射操作：

- `read(provider)`：从已读取的 provider 映射产品设置；旧记录返回 `undefined`，保留自动模式。
- `write(provider, settings)`：把产品编辑值映射为 Core 支持的 provider 请求字段。不得执行网络请求或持久化；真实保存仍经过现有 IPC 流程。

后续需要依据 Core 正式契约完善公共 wire 类型、实现产品 adapter，并在产品设置入口装配。必须确认新增字段缺省、清除语义、完整 URL 与模式关系、代理和 timeout 映射、Bearer/API Key 校验，以及 Core 不支持时的能力识别。不能仅注册 mock adapter 就宣称可用于真实连接。

当前测试中的 `testOnlySettings` 仅用于模拟序列化重读，不是建议采用的 wire 字段。测试隔离真实网络，在 IPC 边界检查三个入口没有发送探测请求；覆盖普通自动模式、无产品 capability、模式切换、迟到的自动修正、失败校验和配置重读。

真实 Core API 保存、更新、重启后读取，以及本地 HTTP 模拟服务收到的 URL、模型、请求头和无探测行为仍待联调；不应据此关闭 #30。Core 版本引用、项目预设及项目交付不属于本次修改。

## 本次修正的变更分类

固定修正起点：`595f0a013`；AionUi 基线仍为 `1afdf95c187f24198ab502a3c86cb2ef40bc3c6f`。

| 文件或 hunk                                    | 所有权 | 类型     | 职责 / 上游原行为                                      | 验证                                       |
| ---------------------------------------------- | ------ | -------- | ------------------------------------------------------ | ------------------------------------------ |
| `ModelSettings/index.tsx`                      | 产品   | 产品实现 | 模式草稿、手动校验与提交路由                           | adapter 与 dialogs 测试                    |
| `ModelSettings/KiBuddyModelSettingsFields.tsx` | 产品   | 产品实现 | 独立手动表单和网关设置                                 | dialogs 测试                               |
| `ModelSettings/KiBuddyGatewayFields.tsx`       | 产品   | 产品实现 | SDK 网关头、代理和三种超时控件                         | dialogs 和 adapter 测试                    |
| `ModelSettings/kiBuddyGatewayValidation.ts`    | 产品   | 产品实现 | SDK 鉴权、请求头和超时校验                             | adapter 失败路径测试                       |
| `ModelSettings/types.ts`                       | 产品   | 产品实现 | 产品草稿类型，不定义 Core wire 字段                    | TypeScript                                 |
| `AddPlatformModal.tsx`                         | 上游   | 集成接缝 | 选择产品表单与提交；关闭时保留原平台表单               | dialogs 创建、无 capability 与模式切换测试 |
| `EditModeModal.tsx`                            | 上游   | 集成接缝 | 选择产品表单与提交；关闭时保留原编辑表单               | dialogs 编辑、取消与无 capability 测试     |
| `AddModelModal.tsx`                            | 上游   | 集成接缝 | 转发编辑目标、选择产品表单与提交；关闭时保留原模型选项 | dialogs 添加与无 capability 测试           |
| `settings.json` 各语言及 `i18n-keys.d.ts`      | 上游   | 支撑材料 | 产品文案及类型生成                                     | i18n 检查                                  |
| `KiBuddyModelSettings` 测试与本说明            | 产品   | 支撑材料 | 模式分离、草稿隔离、提交和无 capability 回归           | Vitest                                     |
