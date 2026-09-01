# 项目产品包配置

`registry.json` 位于受保护的 `product/main`，定义项目产品包允许使用的安装身份、运行身份、平台、集成和功能范围。项目分发分支在仓库根目录维护 `distribution-manifest.json`，其结构由 `schemas/manifest.schema.json` 约束。当前 schema v2 分别使用 `platforms.preview` 和 `platforms.formal` 声明预览与正式平台，不接受旧版平台数组。

首个注册项使用内部标识 `zxjt`。应用显示名保持 `Ki-Buddy`，不在界面展示客户名称；安装包文件名和技术身份使用 `zxjt` 区分。该产品包采用 `local` 身份模式，不启用 `agentsGateway`，并关闭 `account`、`about`、`feedback`、`githubResources`；`agents` 保持启用，用于管理本地 CLI Agent。正式包和预览包分别使用独立的 app id、可执行文件名、URL protocol、数据目录和凭据命名空间。`zxjt` 预览包使用 `macos-arm64` 验证项目资源和隔离身份；首个正式版本只生成和发布 `windows-x64` 与 `windows-arm64` 安装包，不生成或发布正式 macOS、Linux 安装包。

创建项目分发分支时，将 `examples/zxjt.manifest.json` 复制为仓库根目录的 `distribution-manifest.json`，并按实际发布内容更新：

- `version`：稳定 SemVer，不接受预发布版本。
- `baseline.commit`：该分发分支实际基于的 `product/main` 完整 commit SHA。
- `resources`：分发分支内的非敏感品牌资源路径；界面产品名必须保持 `Ki-Buddy`。
- `platforms.preview` / `platforms.formal`：可以从 Ki-Buddy 当前矩阵 `macos-x64`、`macos-arm64`、`windows-x64`、`windows-arm64`、`linux-x64`、`linux-arm64` 中分别选择；每项还必须在受信注册记录的对应 mode 中获准。普通项目包默认可配置三平台双架构的全部六项；`zxjt` 按上述首包策略缩小了各 mode 的平台集合。
- `allowed.requiredPlatforms.preview` / `allowed.requiredPlatforms.formal`：由 `product/main` 的受信注册声明对应 mode 不得省略的平台，并且必须是 `allowed.platforms` 的子集。普通项目可以使用空数组；`zxjt` 的正式集合强制包含两个 Windows 架构，项目分支不能缩成单架构。
- `nonSensitiveConfig`：键必须由受信注册的 `allowed.nonSensitiveConfigKeys` 明确允许，且只能包含随包公开的配置。`zxjt` 当前允许列表为空，因此该对象必须保持 `{}`。
- `allowed.buildCredentialNames`：声明正式构建可以请求的凭据名称，只记录名称，不保存凭据值。名称必须使用 `UPPER_SNAKE_CASE`；`zxjt` 当前为 `[]`，因此不能请求任何项目构建凭据。

`.github/workflows/build-project-preview.yml` 先从 `product/main` 读取受信注册，再解析并固定 source SHA、注册 revision、manifest digest、baseline、`platforms.preview`、Ki-Core 来源和预览身份。验证完成前不会安装或执行项目分支代码，工作流也不读取正式环境凭据。预览 build 与 verify job 根据 `platforms.preview` 展开，并共同消费验证 job 生成的 immutable build plan；当前 `zxjt` 只选择 `macos-arm64`，因此在 `macos-14` 构建并验证一个 DMG。

`.github/workflows/build-project-preview.yml` 选择 `formal` mode 后，只接受 `distribution/<distributionId>` 中可达的完整小写 commit SHA。验证 job 会在执行项目代码前读取 GitHub 的 active branch rules，要求 `deletion` 与 `non_fast_forward` 规则同时生效，并由同一 build contract 校验 active lifecycle、清单版本、正式身份、平台、`delivery-records.json`、请求凭据 allowlist 和 Ki-Core provenance。workflow dispatch 不接收凭据名称；当前 `zxjt` 为 `local` 身份且没有获准的构建凭据，因此正式 workflow 固定请求空列表，也不向项目源码传递项目 secret。

正式构建按 `distributionId + version` 串行。一次 attempt 从清单读取完整 `platforms.formal` 集合，各平台 job 使用同一份 immutable build plan，并从 `.dmg`、`.exe` 或 `.deb` installer 还原待验证应用，不信任旁路上传的 unpacked 目录。build job 使用受信 composite action 安装 Linux 打包依赖并按目标架构重建 Electron native modules。所有平台都检查 executable、项目图标、managed resources、packaged evidence 和 checksum；macOS 另外检查 `Info.plist` 与 URL scheme，Windows 检查 executable `ProductName`、主程序 PE 架构和 `better-sqlite3` PE 架构，Linux 检查 installer 内的 desktop metadata、protocol handler 和已安装图标。项目图标验证只确认配置的项目资源进入安装包，不要求额外的复杂哈希策略。只有全部平台验证成功且 provenance 一致时才创建一个 `project-candidate.json`。artifact 名称、build plan 和 candidate 都包含 GitHub run ID 与 run attempt，重复尝试不会覆盖前一次。部分成功只保留 1 天的验证材料，不形成 candidate。`zxjt` 首包必须同时包含 `windows-x64` 和 `windows-arm64` 两个安装包。

`delivery-records.json` 保存已经确认交付的长期记录。确认安装验收和持久保管副本后，维护者按 `schemas/delivery-record.schema.json` 添加项目版本、源码、注册 revision、manifest digest、candidate attempt、平台 checksum 和保管引用。已记录版本不能再次生成正式 candidate；安装包丢失时发布新的 patch 版本。
