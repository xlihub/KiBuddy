# KiBuddy 模型设置前端适配

对应 [KiBuddy #30](https://github.com/xlihub/KiBuddy/issues/30)。本次范围经用户明确调整为：界面、产品适配接口及 mock 行为测试；真实 API 映射待 [Ki-Core #22](https://github.com/xlihub/Ki-Core/issues/22) 契约确定。

## 当前行为

既有自定义 OpenAI 兼容模型入口支持手动模式和可选网关设置。首次添加、编辑连接和后续添加模型共用 `useKiBuddyModelSettings`；只有显式 KiBuddy product capability 且 platform 为 `custom` 时启用产品行为。

手动模式停止前端模型发现、协议探测及 URL 自动修正，保留用户输入的完整地址与请求模型 ID，并使用 Chat Completions。高级配置不自动启用手动模式，不按主机、客户名称或模型 ID 推断协议。已保存的手动连接关闭手动模式时同时退出其完整 URL 模式，恢复自动发现；原本独立启用完整 URL 的普通连接保留原设置。取消编辑后重新打开会恢复已保存配置，不对取消的地址发起发现请求。

高级设置包含是否发送 Bearer、系统代理/直连、超时秒数及是否发送 `stream_options`。这些是前端编辑值，不代表已发布的 Core 字段或默认值。默认选项表示未指定；超时只校验正整数，具体阶段和服务端限制待 Core 契约明确。请求头名称、凭据录入、替换与清除由对应凭据工单负责。

当前生产环境没有注册 adapter。普通自动配置继续调用原有保存流程；启用手动模式或设置高级选项后，保存会显示未保存提示并保留弹窗。没有把 UI 值发给旧 Core，也没有使用本地 storage 模拟服务端保存。

## 后续 Core 集成位置

`KiBuddyModelSettingsAdapterContext` 提供两个纯映射操作：

- `read(provider)`：从已读取的 provider 映射产品设置；旧记录返回 `undefined`，保留自动模式。
- `write(provider, settings)`：把产品编辑值映射为 Core 支持的 provider 请求字段。不得执行网络请求或持久化；真实保存仍经过现有 IPC 流程。

后续需要依据 Core 正式契约完善公共 wire 类型、实现产品 adapter，并在产品设置入口装配。必须确认新增字段缺省、清除语义、完整 URL 与模式关系、代理和 timeout 映射、Bearer/API Key 校验，以及 Core 不支持时的能力识别。不能仅注册 mock adapter 就宣称可用于真实连接。

当前测试中的 `testOnlySettings` 仅用于模拟序列化重读，不是建议采用的 wire 字段。测试隔离真实网络，在 IPC 边界检查三个入口没有发送探测请求；覆盖普通自动模式、无产品 capability、模式切换、迟到的自动修正、失败校验和配置重读。

真实 Core API 保存、更新、重启后读取，以及本地 HTTP 模拟服务收到的 URL、模型、请求头和无探测行为仍待联调；不应据此关闭 #30。Core 版本引用、项目预设及项目交付不属于本次修改。
