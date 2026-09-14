# zxjt 项目包

`distribution/zxjt` 的项目版本为 `0.1.1`，沿用 Ki-Buddy 图标和显示名。这里的 PNG、ICO、ICNS 是用于实际打包的项目资源副本，来源为 `product/main` commit `04986103f84f1431db45c2793d982d70879529f7` 中对应的 `resources/ki-buddy/app.*`，未改动图像内容。

根目录 `distribution-manifest.json` 引用本目录资源，代码基线更新至 `product/main` commit `769eb9a29825119e2a8d82c249e5645ba2e717bf`（#37），Ki-Core 固定为正式发布的 `0.1.5`。项目版本只由该清单声明；根 `package.json` 和 Ki-Buddy 通用产品版本不改为项目版本。

项目使用 `local` 身份；预览平台为 `macos-arm64`，正式平台为 `windows-x64` 与 `windows-arm64`。`nonSensitiveConfig.modelPreset` 提供手动 Chat Completions 连接、完整请求地址、请求模型 ID 和请求头名称；默认不发送 Bearer、使用直连，并发送 `stream_options`。凭据值由用户在应用内填写，不进入项目清单。

本目录只维护随安装包公开的图标，不保存凭据。正式 source SHA 是提交这些资源与清单的项目 commit，不是上述 baseline commit；执行后续构建时使用已经核验并记录的完整 source SHA。

本地预览构建在项目分支的干净提交上执行：

```bash
node packages/shared-scripts/src/projectDistribution.js resolve \
  --registry distributions/registry.json \
  --manifest distribution-manifest.json \
  --product-config ki-buddy-product.json \
  --mode preview --platforms-json '["macos-arm64"]' \
  --source-sha "$(git rev-parse HEAD)" \
  --registration-revision "$(git rev-parse HEAD)" \
  --output out/zxjt-preview-build-plan.json
KI_BUDDY_RESOLVED_BUILD_PLAN="$PWD/out/zxjt-preview-build-plan.json" \
  NODE_OPTIONS=--max-old-space-size=8192 \
  node scripts/build-with-builder.js arm64 --mac --arm64 --force
```

上述命令验证当前项目源码，不创建正式交付 candidate。现有 GitHub 正式工作流仍从 `product/main` 读取受信校验器；其中也需要允许 `modelPreset.bearer` 的布尔配置。项目分支已包含该修正，但仅合入 `distribution/zxjt` 不会更新受信校验器。CI 安装包验证逻辑不属于本次修改范围。
