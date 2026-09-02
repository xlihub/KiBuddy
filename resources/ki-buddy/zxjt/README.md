# zxjt 首包资源

`distribution/zxjt` 的 `0.1.0` 首包沿用 Ki-Buddy 图标和显示名。这里的 PNG、ICO、ICNS 是用于实际打包的项目资源副本，来源为 `product/main` commit `04986103f84f1431db45c2793d982d70879529f7` 中对应的 `resources/ki-buddy/app.*`，未改动图像内容。

根目录 `distribution-manifest.json` 引用本目录资源，并将同一 commit 记录为项目分发基准。项目使用 `local` 身份，`nonSensitiveConfig` 为 `{}`；预览平台为 `macos-arm64`，正式平台为 `windows-x64` 与 `windows-arm64`。

本目录只维护随安装包公开的图标，不保存凭据。正式 source SHA 是提交这些资源与清单的项目 commit，不是上述 baseline commit；执行后续构建时使用已经核验并记录的完整 source SHA。
