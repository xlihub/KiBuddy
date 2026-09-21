# Ki-Buddy Changelog

本文件记录 Ki-Buddy 产品变化、AionUi 上游变化，以及每个版本固定的 Ki-Core/AionCore 来源。
上游 AionUi 的原始变更记录继续保存在 [`CHANGELOG.md`](CHANGELOG.md)。

## [0.1.8] - 2026-09-21

### Ki-Buddy 定制变化

- 将产品源码身份和正式 GitHub Release provenance 迁移到 `xlihub/KiBuddy`；历史分发仓库 `xlihub/Ki-Buddy` 与源码仓库分别配置。应用内自动更新、手动检查更新和版本下载入口改为新仓库，Web CLI 安装脚本仍沿用原有分发配置。
- 支持手动配置模型、自定义网关和连接选项，并支持项目预设中的 Bearer 认证配置。
- 增加项目专属安装包的品牌、身份隔离和多平台构建配置，并完善安装清理和产物验证。
- 修复 macOS x64 安装包的 keytar 原生依赖打包问题。
- 修复登录、首页、定时任务和会话页面切换后窗口标题被覆盖的问题，保持 Ki-Buddy 产品名称。
- 修复查看定时任务失败详情时触发白屏的问题，并让仅手动运行的任务能够显示失败状态和错误信息。

### AionUi 上游更新

- 继续基于 [AionUi v2.1.61](https://github.com/iOfficeAI/AionUi/releases/tag/v2.1.61)，commit `1afdf95c187f24198ab502a3c86cb2ef40bc3c6f`；本版本没有引入新的 AionUi 上游变化。

### Ki-Core 更新

- 固定 [Ki-Core 0.1.5](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.5)，release commit `d0fddf5ffcee9cacaebde05e2914beac27f93a2a`；采用 Ki-Model 0.1.1 的自定义网关、手动模型和连接选项契约，并包含并发凭据更新修复。
- Ki-Core 继续对应 [AionCore v0.1.72](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.72)，peeled commit `57a34cc1b1a3b17bcc023de06b9e6768fceac36f`。

## [0.1.7] - 2026-08-27

### Ki-Buddy 定制变化

- 定时任务在创建和编辑时保存所选 Assistant 的 Skill、禁用内置 Skill、MCP 及自动注入排除项，使定时启动的新会话使用与普通对话一致的能力配置。
- Agents 执行助手创建定时任务时自动包含内置 `agents-mcp-adapter`；必要的产品 MCP 不可用时阻止保存并提示检查安装完整性。

### AionUi 上游更新

- 继续基于 [AionUi v2.1.61](https://github.com/iOfficeAI/AionUi/releases/tag/v2.1.61)，commit `1afdf95c187f24198ab502a3c86cb2ef40bc3c6f`；本版本没有引入新的 AionUi 上游变化。

### Ki-Core 更新

- 从 [Ki-Core 0.1.3](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.3) 更新到 [Ki-Core 0.1.4](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.4)，release commit `3c4055eb65b7b9d1f2f80ce6008bdf1dae9469cc`；完整差异见 [ki-core-v0.1.3...ki-core-v0.1.4](https://github.com/xlihub/Ki-Core/compare/ki-core-v0.1.3...ki-core-v0.1.4)。
- 定时任务执行时使用创建阶段保存的完整能力快照，并将 MCP 选择解析为新会话运行配置；缺失或不完整的快照会返回明确错误。
- Ki-Core 继续对应 [AionCore v0.1.72](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.72)，peeled commit `57a34cc1b1a3b17bcc023de06b9e6768fceac36f`。

## [0.1.6] - 2026-08-25

### Ki-Buddy 定制变化

- 将 Ki-Buddy 的账户隔离、品牌、功能开关及 Agent、Skill、MCP 资源策略适配到新的设置页、侧栏和运行时结构，继续隐藏未向产品开放的上游资源。
- 保留 Ki-Buddy 的独立安装包、更新源和正式发布流程，并兼容 AionUi v2.1.61 的启动恢复、通知和更新检查变化。

### AionUi 上游更新

- 从 [AionUi v2.1.49](https://github.com/iOfficeAI/AionUi/releases/tag/v2.1.49) 累计更新到 [AionUi v2.1.61](https://github.com/iOfficeAI/AionUi/releases/tag/v2.1.61)，目标 commit `1afdf95c187f24198ab502a3c86cb2ef40bc3c6f`；完整差异见 [v2.1.49...v2.1.61](https://github.com/iOfficeAI/AionUi/compare/v2.1.49...v2.1.61)。
- 增加跨会话提及与投递、置顶计划、归档会话分页、可调侧栏、预览最大化和 SCM 工作区能力。
- 增加 WaveDrom、Mermaid 缩放、Markdown 数学公式、字体族与字重设置，并完善 RTL、多语言、资源管理器和文件预览体验。
- 包含启动恢复、更新降级防护、WebUI、通知、Agent 模型选择及路径安全等修复。

### Ki-Core 更新

- 从 [Ki-Core 0.1.2](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.2) 更新到 [Ki-Core 0.1.3](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.3)，release commit `5cab817d47e0ecc45b979367222a0672fee62099`；完整差异见 [ki-core-v0.1.2...ki-core-v0.1.3](https://github.com/xlihub/Ki-Core/compare/ki-core-v0.1.2...ki-core-v0.1.3)。
- 修复顶层子命令未进入 capability index 的问题，并缩减自动注入 Skill 描述以符合注入预算。
- Ki-Core 同步到 [AionCore v0.1.72](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.72)，peeled commit `57a34cc1b1a3b17bcc023de06b9e6768fceac36f`。

## [0.1.5] - 2026-08-25

### Ki-Buddy 定制变化

- 修复 Windows 安装包在安装校验和文件占用诊断中错误使用 `AionUi.exe` 的问题，改为按 Ki-Buddy 品牌可执行文件名和卸载文件名检查。
- 增加 Windows x64 静默安装冒烟测试，安装器返回非零退出码时明确使构建失败。

### AionUi 上游更新

- 继续基于 [AionUi v2.1.49](https://github.com/iOfficeAI/AionUi/releases/tag/v2.1.49)，commit `28a2a9f57f1bf4f9111b9c33e0cfc1eb918effc8`；本版本没有引入新的 AionUi 上游变化。

### Ki-Core 更新

- 继续固定 [Ki-Core 0.1.2](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.2)，release commit `59c32d9284dd33b344e286404a6292d39df323a0`。
- Ki-Core 仍对应 [AionCore v0.1.59](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.59)，peeled commit `815e61ed9bbe942339347dc1e69ddce176cded76`。

## [0.1.4] - 2026-08-25

### Ki-Buddy 定制变化

- 增加 Agents 平台账户登录、退出和会话生命周期，并按 Agents 部署与平台账户隔离本地状态；默认使用简体中文产品体验。
- 建立 Ki-Buddy 独立品牌、主题、引导页和产品体验策略，统一控制设置、主工作区、资源访问及不可用功能的运行生命周期。
- 内置 Agents MCP Adapter 和 Agents 执行助手，支持 catalog inventory、精确 schema 描述、session cache、单 Agent 直接调用及经授权的本地文件上传。
- 修复 macOS Dock 图标主体占满画布导致视觉尺寸过大的问题，并增加 ICNS 透明边距回归检查。
- 修复正式发布的版本校验和 Draft Release 任务在安装依赖前调用产品发布脚本的问题，并增加覆盖相关 CI/CD job 的依赖安装顺序策略检查。
- `ki-buddy-v0.1.2` 在版本校验阶段失败；`ki-buddy-v0.1.3` 已通过六平台构建、Web CLI 打包和资产校验，但在生成 Release Notes 时失败。两个 tag 均未创建 GitHub Release，继续保留且不移动；本版本使用相同产品映射恢复正式发布。

### AionUi 上游更新

- 继续基于 [AionUi v2.1.49](https://github.com/iOfficeAI/AionUi/releases/tag/v2.1.49)，commit `28a2a9f57f1bf4f9111b9c33e0cfc1eb918effc8`；本版本没有引入新的 AionUi 上游变化。

### Ki-Core 更新

- 从最近公开 Ki-Buddy 版本使用的 [Ki-Core 0.1.0](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.0) 累计更新到 [Ki-Core 0.1.2](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.2)，release commit `59c32d9284dd33b344e286404a6292d39df323a0`。
- 累计包含 Ki-Core 0.1.1 的 Agents 执行助手，以及 Ki-Core 0.1.2 的调用前文件上传规则；完整差异见 [ki-core-v0.1.0...ki-core-v0.1.2](https://github.com/xlihub/Ki-Core/compare/ki-core-v0.1.0...ki-core-v0.1.2)。
- Ki-Core 仍对应 [AionCore v0.1.59](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.59)，peeled commit `815e61ed9bbe942339347dc1e69ddce176cded76`。

## [0.1.3] - 2026-08-24

### Ki-Buddy 定制变化

- 增加 Agents 平台账户登录、退出和会话生命周期，并按 Agents 部署与平台账户隔离本地状态；默认使用简体中文产品体验。
- 建立 Ki-Buddy 独立品牌、主题、引导页和产品体验策略，统一控制设置、主工作区、资源访问及不可用功能的运行生命周期。
- 内置 Agents MCP Adapter 和 Agents 执行助手，支持 catalog inventory、精确 schema 描述、session cache、单 Agent 直接调用及经授权的本地文件上传。
- 修复 macOS Dock 图标主体占满画布导致视觉尺寸过大的问题，并增加 ICNS 透明边距回归检查。
- 修复正式发布校验在安装依赖前读取产品映射，导致干净 runner 缺少 `js-yaml` 而失败的问题。
- `ki-buddy-v0.1.2` 在版本校验阶段失败，没有开始六平台构建，也没有创建 GitHub Release；该 tag 保留且不移动，本版本使用相同产品映射恢复正式发布。

### AionUi 上游更新

- 继续基于 [AionUi v2.1.49](https://github.com/iOfficeAI/AionUi/releases/tag/v2.1.49)，commit `28a2a9f57f1bf4f9111b9c33e0cfc1eb918effc8`；本版本没有引入新的 AionUi 上游变化。

### Ki-Core 更新

- 从最近公开 Ki-Buddy 版本使用的 [Ki-Core 0.1.0](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.0) 累计更新到 [Ki-Core 0.1.2](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.2)，release commit `59c32d9284dd33b344e286404a6292d39df323a0`。
- 累计包含 Ki-Core 0.1.1 的 Agents 执行助手，以及 Ki-Core 0.1.2 的调用前文件上传规则；完整差异见 [ki-core-v0.1.0...ki-core-v0.1.2](https://github.com/xlihub/Ki-Core/compare/ki-core-v0.1.0...ki-core-v0.1.2)。
- Ki-Core 仍对应 [AionCore v0.1.59](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.59)，peeled commit `815e61ed9bbe942339347dc1e69ddce176cded76`。

## [0.1.2] - 2026-08-24

### Ki-Buddy 定制变化

- 增加 Agents 平台账户登录、退出和会话生命周期，并按 Agents 部署与平台账户隔离本地状态；默认使用简体中文产品体验。
- 建立 Ki-Buddy 独立品牌、主题、引导页和产品体验策略，统一控制设置、主工作区、资源访问及不可用功能的运行生命周期。
- 内置 Agents MCP Adapter 和 Agents 执行助手，支持 catalog inventory、精确 schema 描述、session cache、单 Agent 直接调用及经授权的本地文件上传。
- 修复 macOS Dock 图标主体占满画布导致视觉尺寸过大的问题，并增加 ICNS 透明边距回归检查。

### AionUi 上游更新

- 继续基于 [AionUi v2.1.49](https://github.com/iOfficeAI/AionUi/releases/tag/v2.1.49)，commit `28a2a9f57f1bf4f9111b9c33e0cfc1eb918effc8`；本版本没有引入新的 AionUi 上游变化。

### Ki-Core 更新

- 从上一公开 Ki-Buddy 版本使用的 [Ki-Core 0.1.0](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.0) 累计更新到 [Ki-Core 0.1.2](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.2)，release commit `59c32d9284dd33b344e286404a6292d39df323a0`。
- 累计包含 Ki-Core 0.1.1 的 Agents 执行助手，以及 Ki-Core 0.1.2 的调用前文件上传规则；完整差异见 [ki-core-v0.1.0...ki-core-v0.1.2](https://github.com/xlihub/Ki-Core/compare/ki-core-v0.1.0...ki-core-v0.1.2)。
- Ki-Core 仍对应 [AionCore v0.1.59](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.59)，peeled commit `815e61ed9bbe942339347dc1e69ddce176cded76`。

## [0.1.1] - 2026-08-07

### Ki-Buddy 定制变化

- 修复正式 tag 构建无法解析 AionUi 上游 tag 的问题；正式校验会先从版本映射中读取并验证上游仓库与 tag，再获取对应 tag。
- 将产品映射改为只描述当前待发布版本；历史来源继续由不可变 Ki-Buddy tag、CHANGELOG 和 Release provenance 保存。
- `ki-buddy-v0.1.0` 在版本校验阶段失败，没有开始六平台构建，也没有创建 GitHub Release；该 tag 保留且不移动，本版本作为首次正式发布恢复版本。

### AionUi 上游更新

- 继续基于 [AionUi v2.1.49](https://github.com/iOfficeAI/AionUi/releases/tag/v2.1.49)，commit `28a2a9f57f1bf4f9111b9c33e0cfc1eb918effc8`；本版本没有引入新的 AionUi 上游变化。

### Ki-Core 更新

- 继续固定 [Ki-Core 0.1.0](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.0)，release commit `209e6844d39bac0762c61e198c1ba3a007f9dd2e`。
- Ki-Core 仍对应 [AionCore v0.1.59](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.59)，peeled commit `815e61ed9bbe942339347dc1e69ddce176cded76`。

## [0.1.0] - 2026-08-06

### Ki-Buddy 定制变化

- 建立 Ki-Buddy 独立产品版本、版本映射、版本准备校验和正式发布流程。
- 正式构建固定消费 Ki-Core Release，校验六个平台 checksums、archive 内容和来源信息。
- 手工构建保留 Ki-Core Candidate Build 联调入口，本地开发保留显式本地 binary/bundle。

### AionUi 上游更新

- 基线更新到 [AionUi v2.1.49](https://github.com/iOfficeAI/AionUi/releases/tag/v2.1.49)，commit `28a2a9f57f1bf4f9111b9c33e0cfc1eb918effc8`。
- 增加音频附件、语音输入、结构化问题卡片和 ACP 命令实时终端卡片。
- 增加 Team 消息与任务活动视图，并完善按项目保存的预览面板。
- 包含移动端文件操作、长任务会话状态、慢速后端启动和 agent 进程清理等修复。

### Ki-Core 更新

- 固定 [Ki-Core 0.1.0](https://github.com/xlihub/Ki-Core/releases/tag/ki-core-v0.1.0)，release commit `209e6844d39bac0762c61e198c1ba3a007f9dd2e`。
- Ki-Core 对应 [AionCore v0.1.59](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.59)，peeled commit `815e61ed9bbe942339347dc1e69ddce176cded76`。
- AionCore 提供原生图片/音频内容块、Team mailbox/task API 与实时事件；Aion CLI runtime 更新到 `v0.2.9`。
