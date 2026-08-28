# Ki 产品

本上下文定义 Ki 产品在上游发布管理和 Agents 混合执行中使用的统一术语。

## 发布语言

**上游候选版本**：
已经完整发布、可供管理员评估，但尚未被 Ki 产品接受的 AionCore 或 AionUi 正式版本。候选版本不会自动触发同步或 Ki 产品发布。
_Avoid_：待同步版本、最新必跟版本

**发布基准**：
管理员为某次 Ki 产品发布明确选择的上游 tag 和 commit。继续使用当前基准也是一次有效选择。
_Avoid_：最新上游、默认版本

**独立发布节奏**：
Ki-Core 与 Ki-Buddy 根据自身产品计划决定发布时间和版本号，上游发布只提供候选版本。
_Avoid_：延迟一周同步、跟随上游发布

**通用产品公开分发源**：
面向普通 Ki-Buddy 用户公开提供正式安装包和自动更新元数据的自建 OSS/CDN；源码仓库及其 GitHub Release 不承担客户端公开下载或更新服务。
_Avoid_：GitHub public Release、项目交付渠道、源码仓库

**Ki 产品源码边界**：
由 standalone private `KiBuddy` 与 public fork `Ki-Core` 组成的并列源码边界；两者分别跟随自己的 public upstream，保留独立历史、版本和发布节奏，不组成 monorepo 或源码包含关系。
_Avoid_：KiBuddy monorepo、private `KiCore`、Git submodule

**通用产品源码仓库**：
名为 `KiBuddy` 的 standalone private repository，保存 Ki-Buddy 桌面产品源码、AionUi 上游映射和项目分发分支。
_Avoid_：通用服务端源码仓库、AionUi public fork、公开分发源

**通用服务端源码仓库**：
现有 public fork `xlihub/Ki-Core`，保存 Ki-Core 服务端产品源码和 AionCore 上游映射；它拥有独立于 KiBuddy 的版本与发布节奏，并继续作为 KiBuddy 的公开二进制来源。
_Avoid_：private `KiCore`、通用产品源码仓库、KiBuddy 子目录

**历史公开产品源码仓库**：
现有 public fork `Ki-Buddy`；完成 private KiBuddy 迁移后作为只读历史保存，不再承担新的产品开发或发布。
_Avoid_：通用产品源码仓库、通用服务端源码仓库、长期镜像仓库

**内部产品 Release**：
private `KiBuddy` 仓库中的 GitHub tag 和 Release，用于汇集桌面产品的已验证资产、审批和记录来源；它不是 Ki-Buddy 用户公开下载或自动更新的来源。
_Avoid_：通用产品公开分发源、GitHub public Release、项目交付记录

**Ki-Core 二进制来源**：
public `xlihub/Ki-Core` 的不可变 Release 或已验证 candidate artifact；KiBuddy 将其二进制和 managed resources 打入安装包，并保留公开仓库、版本、commit 与 checksum provenance，但不包含 Ki-Core 源码。
_Avoid_：private KiCore、源码内嵌、匿名二进制

**项目分发版本**：
面向一个指定客户或项目、长期维护并可重复构建和升级的 Ki-Buddy 专属版本；它拥有独立于标准 Ki-Buddy 和其他项目分发版本的安装与数据身份。
_Avoid_：临时构建、客户定制包、标准 Ki-Buddy Release

**预览构建**：
供项目内部验证的项目分发版本构建结果，不构成面向客户的正式交付。
_Avoid_：正式交付包、正式 Release

**正式交付构建**：
经过项目规定的质量、安全和授权检查，可交付给目标客户使用的项目分发版本构建结果。
_Avoid_：预览包、调试构建、标准 Ki-Buddy Release

**项目安装身份**：
一个项目分发版本在操作系统、本地数据和系统凭据中的唯一身份，使其可以与标准 Ki-Buddy 及其他项目分发版本共存。
_Avoid_：显示名称、项目分支名、标准 Ki-Buddy 身份

**项目分发基准**：
一个项目分发版本明确采用的 `product/main` commit；项目可以按自己的维护节奏选择基准，不自动采用当前最新提交。
_Avoid_：最新 Ki-Buddy、当前 `product/main`、标准 Ki-Buddy 发布基准

**项目版本**：
项目分发版本独立维护的 SemVer，用于表达该项目自身的升级顺序；对应的 Ki-Buddy 项目分发基准作为独立来源证据记录。
_Avoid_：Ki-Buddy 版本、workflow run ID、构建日期

**项目分发清单**：
受版本控制的项目配置声明，描述一个项目分发版本采用的非敏感产品配置；任何进入安装包或改变运行行为的变化都形成新的项目版本，它不能扩大项目注册记录授予的范围，也不能保存长期凭据。
_Avoid_：项目授权记录、标准产品配置、项目凭据

**Ki-Buddy runtime family**：
标准 Ki-Buddy 与所有项目分发版本共享的产品能力和 runtime contract；具体项目通过 `distributionId` 区分，不创建新的 runtime 产品类别。
_Avoid_：项目 runtime、标准 Ki-Buddy 安装身份、项目分发版本

**distributionId**：
一个项目分发版本在 Ki-Buddy runtime family 中不可变且全局唯一的非敏感 slug；它可以出现在安装身份、构建证据和日志中，项目名称、分支名和版本变化不会改变它。
_Avoid_：客户名称、随机密钥、branch、appId、项目版本

**项目注册记录**：
由 Ki-Buddy 基线维护、用于确认一个 `distributionId` 已获准存在及其生命周期、不可变身份和交付授权边界的权威记录；项目分发清单与它冲突时不能构建。
_Avoid_：项目分发清单、项目业务配置、项目凭据

**项目注册状态**：
项目注册记录对新构建的授权状态：`active` 允许预览和正式交付，`suspended` 只允许预览，`retired` 禁止所有新构建、撤销项目构建密钥并使分发分支只读，同时保留交付证据且对应 `distributionId` 永不复用；它不控制已经交付客户端的运行状态。
_Avoid_：branch 状态、项目版本状态、客户使用状态

**项目交付记录**：
一次正式交付的长期来源证据，标识项目版本、源码、项目注册记录、项目分发清单、目标平台、候选 attempt、安装包摘要和持久保管引用，但不保存安装包本身。
_Avoid_：Actions artifact、项目分发清单、GitHub Release

**项目交付候选**：
正式交付构建通过自动检查后产生、等待管理员完成安装验收和交付确认的安装包集合；同一项目版本的正式构建串行执行，可以有多个具有独立摘要的候选 attempt，只有被确认交付的 attempt 固定该版本。
_Avoid_：项目交付记录、正式 Release、已交付版本

**项目持久交付副本**：
由项目交付负责人长期保管、与项目交付记录中的摘要和保管引用一致的安装包集合；临时构建 artifact 不构成持久交付副本。
_Avoid_：Actions artifact、重新构建产物、项目交付记录

**正式构建源**：
项目正式交付构建采用的精确源码版本，必须属于对应项目受保护的分发分支并已通过规定检查；未合并源码只能产生预览构建。
_Avoid_：任意 commit、可变 branch head、预览源码

**项目构建密钥域**：
一个 `distributionId` 的正式构建可以使用、且不能被其他项目或预览构建读取的受保护凭据范围；项目源码和安装包不得包含其中的长期凭据。
_Avoid_：仓库全部 secrets、共享项目密钥、随包凭据

**项目预览身份**：
项目内部预览构建使用的独立安装与数据身份，不与同一项目的正式安装共享本地状态。
_Avoid_：项目安装身份、正式交付构建、调试参数

**项目身份模式**：
项目分发版本对用户身份来源作出的单一明确选择：`local` 不要求登录，`agents` 使用 Agents 平台账户，`external` 通过项目身份 adapter 使用第三方账户；同一 `distributionId` 的身份模式在其生命周期内保持不变。`external` 是远期架构方向，不属于当前项目分发实现。
_Avoid_：登录页面类型、项目体验策略、自动身份检测

**当前可交付身份模式**：
当前项目分发可以实际构建和交付的 `local` 与 `agents` 两种项目身份模式；第三方 `external` 身份不能作为当前项目分发清单的有效选择，也不提供不可用入口或占位能力。
_Avoid_：`external`、目标身份模式、自动身份检测

**项目身份 adapter**：
远期由项目拥有的窄集成模块，为 `external` 身份模式提供第三方会话、稳定用户主体和权限声明；第三方协议和凭据不进入公共身份入口。
_Avoid_：Agents MCP Adapter、公共登录 service、第三方 SDK 全局封装

**项目身份投影**：
将项目身份模式提供的稳定用户主体映射为 Core 用户的关系；投影包含 `distributionId` 和身份提供方边界，避免跨项目、租户或提供方共享本地用户空间。
_Avoid_：Agents 身份投影、username 映射、`system_default_user`

**项目权限声明**：
项目身份 adapter 为改善客户端交互提供的当前用户能力信息；最终资源授权仍由第三方服务端执行，客户端显隐不构成安全授权。
_Avoid_：产品体验策略、服务端授权、角色名称

**Agents Gateway 集成**：
项目分发版本是否启用 Agents catalog、远端调用和 Agents MCP Adapter 的独立集成选择；它不由项目身份模式或 `tools` 产品能力隐式决定。
_Avoid_：Agents 身份模式、`agents` 产品能力、Tools 设置

**Agents 部署策略**：
`agents` 身份模式对 Agents 部署地址的选择规则：`fixed` 由项目声明固定范围，`user-selectable` 允许用户选择部署；它不构成 `distributionId` 的身份。
_Avoid_：项目身份模式、项目安装身份、Agents 部署

**Core external compatibility marker**：
Ki-Buddy 调用当前 Core external user/session contract 时使用的 `user_type=aionpro` wire value；当前 `agents` 模式使用该值，远期 `external` 模式也沿用该值，但它不表示项目用户属于 AionPro 或 Agents。
_Avoid_：项目身份模式、AionPro 用户类型、第三方账户类型

**外部身份 namespace**：
远期 `external` 项目身份投影使用的稳定提供方与租户边界，由 `providerId` 及 issuer/tenant 共同标识；同一 `distributionId` 生命周期内保持不变。
_Avoid_：username、角色名称、服务地址

## 产品与身份

**AionUi 开源版**：
由上游 GitHub 仓库公开发布的 AionUi 产品基线；其桌面客户端不包含 AionPro 的账户、强制登录和用户管理模块。
_Avoid_：AionPro、官网生产版、完整 AionUi 产品

**AionPro 生产版**：
由 AionUi 官网分发、包含闭源 AionPro 产品模块的桌面客户端；账户与登录属于该产品的组成部分。
_Avoid_：AionUi 开源版、upstream build、公开 tag

**Agents 部署**：
由一个 `base_url` 标识的中心化 Agents 平台实例，拥有自己的用户、组织、角色、权限和 token 签发边界。
_Avoid_：账户服务器、Ki-Buddy 后端、通用 Agents 云

**Agents 平台账户**：
注册在一个 Agents 部署中的用户身份，是 Ki-Buddy 客户端的登录主体，并决定用户可发现和调用的已发布 agent。
_Avoid_：Ki-Buddy 账户、桌面账户、跨部署账户

**客户端登录会话**：
Ki-Buddy 使用 Agents 平台账户在一个 Agents 部署上建立的当前登录状态；Ki-Buddy 不另外创建产品账户。
_Avoid_：Ki-Buddy 账户、账户绑定、AionPro 会话

**Agents 用户凭证**：
Agents 部署在账号密码验证成功后派发、只用于该部署 catalog 和 invoke 的 token。
_Avoid_：Ki-Buddy token、AionPro token、Core session

**本地退出**：
Ki-Buddy 结束当前客户端登录会话并清除本机凭证与运行状态，但不保证 Agents 已签发的凭证在服务端立即失效。
_Avoid_：服务端 logout、token revoke、远端强制下线

**Core 用户**：
AionCore 内部用于确定本地资源和运行时状态归属的用户主体；它可以由外部产品身份投影产生，但不等同于 Agents 平台账户。
_Avoid_：Agents 用户、桌面账号、`system_default_user`

**Agents 身份投影**：
将一个 Agents 部署中的 Agents 平台账户稳定映射为 Core 用户的产品关系，使本地工作历史与运行时状态拥有明确的用户归属。
_Avoid_：AionPro 账户复用、用户名映射、裸用户 ID 映射

**用户工作历史**：
归属于一个 Agents 部署中某个 Agents 平台账户的持久化 conversation、Team 记录和结果引用。
_Avoid_：登录会话、临时状态、全局历史

## 产品能力控制

**产品体验策略**：
一个产品版本对 AionUi 功能、资源和默认行为作出的统一可用性声明；同一声明同时约束用户入口、直接访问和相关运行行为。
_Avoid_：页面显隐清单、菜单白名单、Ki-Buddy 条件判断

**随包产品策略**：
随 Ki-Buddy 安装包发布并由该版本唯一采用的产品体验策略；产品功能变化通过发布新版本生效。
_Avoid_：远程功能开关、用户功能开关、环境变量覆盖

**产品能力 ID**：
在产品体验策略中稳定标识一项完整产品能力的领域名称；入口、直接访问和运行行为可以共同引用同一个 ID。
_Avoid_：路由路径、组件名、菜单 ID

**产品功能状态**：
产品体验策略对一项完整产品能力作出的启用或停用决定；停用表示该能力不可展示、不可直接访问，也不启动其专属运行行为，但不构成底层接口的安全授权。
_Avoid_：仅隐藏、CSS 隐藏、菜单开关

**首发数据基线**：
Ki-Buddy 第一个正式版本使用独立且没有历史产品数据的运行空间；开发数据、AionUi 数据和未正式发布版本的数据不构成产品兼容输入。
_Avoid_：旧版 Ki-Buddy 数据、AionUi 数据迁移、预发布数据兼容

**产品资源访问**：
产品体验策略对一类 Agent、Assistant、Model、Skill 或 MCP 资源规定的隐藏、使用或管理范围；使用允许调用及必要的运行检测，但不允许改变资源定义，管理保留该类资源的完整管理能力。
_Avoid_：列表过滤、按钮显隐、资源权限

**产品内置资源**：
由 Ki-Buddy 随产品发布并负责定义和生命周期的 Agent、Assistant、Skill 或 MCP 资源；用户可以使用和检测，但不能修改其定义。
_Avoid_：上游内置资源、Custom 资源、Extension 贡献资源

**上游内置资源**：
由 AionUi 或 AionCore 提供、但没有被 Ki-Buddy 声明为产品内置资源的 Agent、Assistant、Skill 或 MCP 资源。
_Avoid_：产品内置资源、Custom 资源

**未分类资源**：
Ki-Buddy 无法依据稳定身份和来源归入已声明资源类别的上游或 Extension 资源；它不自动取得可见或可用状态。
_Avoid_：Custom 资源、默认允许资源

**Custom 资源**：
用户通过 Ki-Buddy 保留的内置扩展入口创建并管理的 Agent、Assistant、Model、Skill 或 MCP 资源。
_Avoid_：Extension 贡献资源、产品内置资源、上游内置资源

**Extension 贡献资源**：
AionUi Extension 运行时提供的设置页、Agent、Skill 或 MCP 资源；它不因表现得像 Custom 资源而取得 Custom 资源访问范围。
_Avoid_：Custom 资源、产品内置资源

**自动注入 Skill**：
AionCore 在 conversation 运行时自动提供、无需用户从 Skills 目录选择的 Skill；它是否注入与是否在 Skills 设置页展示是两个独立决定。
_Avoid_：产品官方 Skill、Custom Skill、目录可见 Skill

**定时任务**：
由一个 Assistant 按计划在新 conversation 或指定的现有 conversation 中执行的任务；Team 不是定时任务执行者。
_Avoid_：Team 定时任务、Team 执行计划

## Agents 混合执行

**混合执行**：
Team Lead 将用户任务分配给本地成员，并通过 Agents 执行助手使用 Agents 平台已发布的远端能力，最后综合本地与远端结果。
_Avoid_：混合编排、远端 Team

**Agents 执行助手**：
Ki-Buddy 内置的本地 Assistant，在 standalone conversation 中直接服务用户，在 Team 中作为 member 使用 Agents 平台能力。
_Avoid_：Agents Planner、远端 agent teammate

**Agents 执行助手实例**：
Team 中由同一 Agents 执行助手定义创建的一个独立 member slot；多个实例以 `slot_id` 区分。
_Avoid_：Assistant 定义、显示名称、远端 agent

**Agents MCP Adapter**：
Ki-Buddy 拥有的本地集成模块，是 Agents 执行助手访问 Agents 平台已发布能力的接口；Agents 平台负责其 Bridge contract。
_Avoid_：Agents runtime、Planner MCP、平台 Adapter package

**已发布 agent**：
当前用户在 Agents 平台获权且可通过 catalog 发现的远端智能体，不具备 Ki-Buddy Team member 身份。
_Avoid_：远端成员、本地 agent 包

**安全 catalog**：
Agents 平台针对当前平台账户返回的完整已发布 agent 集合；“安全”只表示授权范围和敏感字段投影，不表示内容可信。
_Avoid_：全平台 agent、静态能力列表、内容安全证明

**catalog inventory**：
安全 catalog 的完整紧凑视图，用于比较候选；精确输入输出 schema 由 `describe` 提供。
_Avoid_：agent 详情、关键词搜索结果、部分 catalog

**catalog inventory task**：
Team 中用于建立或刷新 catalog inventory 的非执行任务，它报告当前能力但不调用已发布 agent。
_Avoid_：execution task、catalog 搜索、能力调用

**execution task**：
Team Lead 分配给 Agents 执行助手的一次远端执行请求。
_Avoid_：catalog inventory task、远端工作流、批量执行

**补参请求**：
Agents 执行助手根据已选 agent 的精确 schema 请求补齐必填字段的非执行结果；standalone 中面向用户，Team 中交给 Lead。
_Avoid_：参数猜测、invoke 失败、新 execution task

**明确执行请求**：
用户在 standalone conversation 中要求远端执行，或 Lead 根据用户目标分配的 execution task。
_Avoid_：inventory 请求、候选咨询、永久授权

## Agents 执行生命周期

**Agents 执行生命周期**：
Agents 平台拥有的远端 task identity、服务端幂等、status、cancel、resume、retry 和审计语义，通过正式 MCP contract 提供给客户端。
_Avoid_：Ki-Buddy 执行状态、本地恢复状态机、客户端幂等登记

**远端 taskId**：
Agents MCP contract 在一个 Agents 部署和平台账户范围内提供、用于标识远端执行请求的稳定 ID。
_Avoid_：进程内计数器、conversationId、requestId

**active invocation**：
Agents MCP contract 明确报告为已经开始但尚未取得终态的远端调用；Ki-Buddy 不根据本地等待或进程状态推断该状态。
_Avoid_：本地请求等待、pending task、catalog 请求

**停止等待**：
用户要求 Ki-Buddy 结束对一次 direct invoke 的本地等待；它不表示 Agents 远端执行已经取消。
_Avoid_：远端取消、执行失败、确认已停止

**Agents 审计记录**：
Agents 平台持有的中心化服务端执行证据，记录平台身份、获权 agent、远端执行和终态。
_Avoid_：客户端 conversation 历史、客户端结果文件、Adapter 日志

## 文件与 workspace

**项目 workspace**：
用户通过“在项目中工作”明确选择并绑定给 conversation 或 Team 的外部本地目录；其内容遵循操作系统文件权限。
_Avoid_：自动 workspace、账号私有目录、结果档案库

**自动 workspace**：
用户未选择项目时，由 Ki-Core 为当前 Core 用户的 conversation 或 Team 建立并管理的工作目录。
_Avoid_：项目 workspace、全局临时目录、外部导出目录

**effective workspace**：
当前 conversation 或 Team 实际使用的项目 workspace 或自动 workspace，是本地输入与结果文件的工作边界。
_Avoid_：Adapter 目录、全局结果目录、任意本地路径

**本地文件授权**：
Ki-Buddy 根据当前请求的明确附件选择，或用户对某个 workspace 文件的逐文件确认生成的一次性 file grant；它不表示远端 task identity 或执行状态。
_Avoid_：项目目录授权、模型提供的路径、文件系统读取权限

**上传引用**：
Adapter 为当前 session 中已经上传的远端文件输入生成的一次性不透明 `uploadRef`；它不暴露真实 `fileUrl`。
_Avoid_：fileUrl、本地路径、Agents 文件 ID

**远端执行文件产物**：
Agents 平台通过正式 execution artifact contract 与一次远端执行关联并提供获取语义的文件结果；Ki-Buddy 不根据 invoke JSON、URL 或字段名称推断这种关联。
_Avoid_：客户端结果文件、任意输出 URL、本地 `deliveryRef`
