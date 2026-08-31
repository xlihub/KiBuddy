# 项目产品包配置

`registry.json` 位于受保护的 `product/main`，定义项目产品包允许使用的安装身份、运行身份、平台、集成和功能范围。项目分发分支在仓库根目录维护 `distribution-manifest.json`，其结构由 `schemas/manifest.schema.json` 约束。

首个注册项使用内部标识 `zxjt`。应用显示名保持 `Ki-Buddy`，不在界面展示客户名称；安装包文件名和技术身份使用 `zxjt` 区分。该产品包采用 `local` 身份模式，不启用 `agentsGateway`，并关闭 `account`、`about`、`feedback`、`githubResources`；`agents` 保持启用，用于管理本地 CLI Agent。正式包和预览包分别使用独立的 app id、可执行文件名、URL protocol、数据目录和凭据命名空间。

创建项目分发分支时，将 `examples/zxjt.manifest.json` 复制为仓库根目录的 `distribution-manifest.json`，并按实际发布内容更新：

- `version`：稳定 SemVer，不接受预发布版本。
- `baseline.commit`：该分发分支实际基于的 `product/main` 完整 commit SHA。
- `resources`：分发分支内的非敏感品牌资源路径；界面产品名必须保持 `Ki-Buddy`。
- `nonSensitiveConfig`：键必须由受信注册的 `allowed.nonSensitiveConfigKeys` 明确允许，且只能包含随包公开的配置。`zxjt` 当前允许列表为空，因此该对象必须保持 `{}`。

`.github/workflows/build-project-preview.yml` 先从 `product/main` 读取受信注册，再解析并固定 source SHA、注册 revision、manifest digest、baseline、平台、Ki-Core 来源和预览身份。验证完成前不会安装或执行项目分支代码，工作流也不读取正式环境凭据。
