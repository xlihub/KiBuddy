# 项目产品包配置

`registry.json` 位于受保护的 `product/main`，定义项目产品包允许使用的安装身份、运行身份、平台、集成和功能范围。项目分发分支在仓库根目录维护 `distribution-manifest.json`，其结构由 `schemas/manifest.schema.json` 约束。

首个注册项使用内部标识 `zxjt`。应用显示名保持 `Ki-Buddy`，不在界面展示客户名称；安装包文件名和技术身份使用 `zxjt` 区分。该产品包采用 `local` 身份模式，不启用 `agentsGateway`，并关闭 `account`、`about`、`feedback`、`githubResources`；`agents` 保持启用，用于管理本地 CLI Agent。正式包和预览包分别使用独立的 app id、可执行文件名、URL protocol、数据目录和凭据命名空间。

创建项目分发分支时，将 `examples/zxjt.manifest.json` 复制为仓库根目录的 `distribution-manifest.json`，并按实际发布内容更新：

- `version`：稳定 SemVer，不接受预发布版本。
- `baseline.commit`：该分发分支实际基于的 `product/main` 完整 commit SHA。
- `resources`：分发分支内的非敏感品牌资源路径；界面产品名必须保持 `Ki-Buddy`。
- `nonSensitiveConfig`：键必须由受信注册的 `allowed.nonSensitiveConfigKeys` 明确允许，且只能包含随包公开的配置。`zxjt` 当前允许列表为空，因此该对象必须保持 `{}`。
- `allowed.buildCredentialNames`：声明正式构建可以请求的凭据名称，只记录名称，不保存凭据值。名称必须使用 `UPPER_SNAKE_CASE`；`zxjt` 当前为 `[]`，因此不能请求任何项目构建凭据。

`.github/workflows/build-project-preview.yml` 先从 `product/main` 读取受信注册，再解析并固定 source SHA、注册 revision、manifest digest、baseline、平台、Ki-Core 来源和预览身份。验证完成前不会安装或执行项目分支代码，工作流也不读取正式环境凭据。

`.github/workflows/build-project-preview.yml` 选择 `formal` mode 后，只接受 `distribution/<distributionId>` 中可达的完整小写 commit SHA。验证 job 会在执行项目代码前读取 GitHub 的 active branch rules，要求 `deletion` 与 `non_fast_forward` 规则同时生效，并由同一 build contract 校验 active lifecycle、清单版本、正式身份、平台、`delivery-records.json`、请求凭据 allowlist 和 Ki-Core provenance。workflow dispatch 不接收凭据名称；当前 `zxjt` 为 `local` 身份且没有获准的构建凭据，因此正式 workflow 固定请求空列表，也不向项目源码传递项目 secret。

正式构建按 `distributionId + version` 串行。只有独立验证 job 成功后才上传正式 candidate；artifact 名称、build plan 和 `project-candidate.json` 都包含 GitHub run ID 与 run attempt，重复尝试不会覆盖前一次。失败 run 可能保留 1 天的内部验证材料或未验证构建，但不会形成正式 candidate。

`delivery-records.json` 保存已经确认交付的长期记录。确认安装验收和持久保管副本后，维护者按 `schemas/delivery-record.schema.json` 添加项目版本、源码、注册 revision、manifest digest、candidate attempt、平台 checksum 和保管引用。已记录版本不能再次生成正式 candidate；安装包丢失时发布新的 patch 版本。
