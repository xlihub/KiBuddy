# 问题跟踪：GitHub

本仓库的问题和规格在 GitHub 仓库 `xlihub/KiBuddy` 中管理。所有操作使用 `gh` CLI。由于本地仓库配置了多个远程仓库，命令必须传入 `--repo xlihub/KiBuddy`。

public 仓库 `xlihub/Ki-Buddy` 中已有的 issue 仅作为历史记录保留，不再接收新的 issue、spec 或 triage 操作。

## 常用操作

- **创建 issue**：`gh issue create --repo xlihub/KiBuddy --title "..." --body "..."`。多行正文使用 heredoc。
- **读取 issue**：`gh issue view <number> --repo xlihub/KiBuddy --comments`。需要结构化数据时，同时获取标签并使用 `jq` 过滤评论。
- **列出 issue**：`gh issue list --repo xlihub/KiBuddy --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按任务需要增加 `--label` 和 `--state`。
- **评论 issue**：`gh issue comment <number> --repo xlihub/KiBuddy --body "..."`
- **添加或移除标签**：`gh issue edit <number> --repo xlihub/KiBuddy --add-label "..."` 或 `--remove-label "..."`
- **关闭 issue**：`gh issue close <number> --repo xlihub/KiBuddy --comment "..."`

Issue 标题、正文和评论使用简体中文；命令、标签和代码标识保留原文。

## 将 Pull Request 作为 triage 输入

**PRs as a request surface: no.**

该固定标识供 `/triage` 读取。若仓库以后将外部 Pull Request 作为功能请求处理，可将 `no` 改为 `yes`。

设置为 `yes` 后，Pull Request 使用与 issue 相同的标签和状态：

- **读取 PR**：使用 `gh pr view <number> --repo xlihub/KiBuddy --comments` 和 `gh pr diff <number> --repo xlihub/KiBuddy`。
- **列出待分类的外部 PR**：运行 `gh pr list --repo xlihub/KiBuddy --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的条目。
- **评论、设置标签或关闭 PR**：使用 `gh pr comment`、`gh pr edit` 和 `gh pr close`，并传入 `--repo xlihub/KiBuddy`。

GitHub 的 issue 和 Pull Request 共用编号空间。遇到 `#42` 时，先运行 `gh pr view 42 --repo xlihub/KiBuddy`；若不是 Pull Request，再运行 `gh issue view 42 --repo xlihub/KiBuddy`。

## 技能要求“发布到问题跟踪系统”时

在 `xlihub/KiBuddy` 中创建 GitHub issue。

## 技能要求“读取相关工单”时

运行 `gh issue view <number> --repo xlihub/KiBuddy --comments`。

## Wayfinding 操作

`/wayfinder` 使用一个 map issue 管理多个 child issue。

- **Map**：带有 `wayfinder:map` 标签的单个 issue，正文包含 Notes、Decisions-so-far 和 Fog。
- **Child ticket**：通过 GitHub sub-issue 关联到 map。若仓库未启用 sub-issue，将 child 加入 map 正文的任务列表，并在 child 正文顶部写入 `Part of #<map>`。标签格式为 `wayfinder:<type>`，其中 type 为 `research`、`prototype`、`grilling` 或 `task`。领取后，将工单分配给当前开发者。
- **依赖关系**：优先使用 GitHub 原生 issue dependencies。添加依赖的命令为 `gh api --method POST repos/xlihub/KiBuddy/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`。`<blocker-db-id>` 必须是 blocker 的数字 database ID。若原生依赖不可用，在 child 正文顶部写入 `Blocked by: #<n>, #<n>`。
- **Frontier 查询**：列出 map 中尚未关闭的 child，排除仍有开放 blocker 或已有 assignee 的工单，选择 map 顺序中的第一个剩余工单。
- **领取**：运行 `gh issue edit <n> --repo xlihub/KiBuddy --add-assignee @me`。
- **完成**：用简体中文评论处理结果，关闭工单，然后在 map 的 Decisions-so-far 中追加上下文说明和链接。
