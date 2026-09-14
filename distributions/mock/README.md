# zxjt 本地模型网关 Mock

供 Ki-Core、KiBuddy 的模型配置与 Agent 链路连接的独立 HTTP 服务。只需要 Python 3.10+ 标准库，无联网安装依赖；不调用客户服务、不包含客户凭据、不执行工具。Python 是开发验证依赖，与客户现场 PowerShell 采集工具无关。

## 启动与配置

在仓库根目录执行（Windows 将 `python3` 换成 `python`）：

```bash
python3 distributions/mock/kiBuddyZxjtServer.py --record /tmp/zxjt-mock-requests.jsonl
```

默认监听 `127.0.0.1:18789`。可通过 `--port` 更换端口；`--port 0 --ready-file /tmp/zxjt-mock-ready.json` 让系统分配端口，并记录实际地址与 PID。Ctrl+C 停止服务。路径含空格时按当前 shell 的规则加引号。Windows 的日志路径应换成有效本地路径。

KiBuddy 的自定义模型连接填写：

| 配置                   | 值                                         |
| ---------------------- | ------------------------------------------ |
| 完整聊天 URL           | `http://127.0.0.1:18789/inner/ai/llm/chat` |
| 模型 ID                | `qwen3.8-27b-zxjt`                         |
| 协议                   | Chat Completions                           |
| 模型模式               | 手动，不执行模型发现或 URL 修正            |
| Bearer                 | 关闭，API Key 留空                         |
| 自定义请求头 appId     | `mock-app-id`                              |
| 自定义请求头 secretKey | `mock-secret-key`                          |
| 自定义请求头 apikey    | `mock-api-key`                             |
| 网络                   | 直连，仅作用于当前连接                     |
| stream_options         | 关闭或开启均可验证，现场两种请求均成功     |

这些值是公开的本地测试凭据。环境变量 `ZXJT_MOCK_APP_ID`、`ZXJT_MOCK_SECRET_KEY`、`ZXJT_MOCK_API_KEY` 可以替换服务端期望值；不要使用客户真实密钥。额外 Bearer 在三头完整时被接受，单独 Bearer 仍失败。错误凭据采用与缺失凭据相同的错误是模拟扩展，现场只验证过缺失组合。

本服务可直接接收 Core/SDK 的真实 HTTP 请求，但当前开发分支的桌面高级配置和 Core 保存契约可能尚未全部贯通。必须在包含相应功能的版本中配置；出现缺头错误时应检查请求记录，不能为了让检查通过而关闭 mock 鉴权。这里不提供未经核对的 Core 创建 provider API JSON。

若 Core 在容器、虚拟机或另一台 Windows 主机中，`127.0.0.1` 指向 Core 所在环境。可在那台机器启动相同服务，或者显式使用 `--host 0.0.0.0`，让客户端填写运行 mock 的主机可达地址。此选项仅用于受控开发网络；mock 管理接口没有额外认证。

## 两种验证方式

### field：按现场规则响应新请求（默认）

真实路由只有 `POST /inner/ai/llm/chat`，错误路径和模型发现路径返回 404，以便发现客户端意外追加 `/chat/completions` 或发起模型发现。这些未记录路由的 404 是 mock 的检查规则，不是客户服务的已知行为。

- 缺 apikey：HTTP 202，现场 `errcode/errmsg` JSON。
- apikey 正确、缺 appId 或 secretKey：HTTP 200，现场身份验证失败文本 SSE。
- 错误模型 ID：HTTP 200，现场模型名错误文本 SSE；即使请求 stream=false 也返回 SSE。
- named tool_choice 对象：HTTP 200，`data:Bad Request`；当前模拟不支持命名强制选择。
- 普通对话：使用现场 JSON / 无空格 SSE 格式，响应模型为 `qwen3.8-27b`；持续产生多个事件、usage-only、`[DONE]`。
- 采集标记提示词返回 `ZXJT_PROBE_OK`；max_tokens=16 的健康检查形态返回 `OK`；其余普通输入返回带 `[ZXJT MOCK]` 前缀的确定性文本。
- `stream_options`、`parallel_tool_calls`、`reasoning_effort` 的已采样形式被接受；后两项不改变生成行为，不能用于证明模型能力。

新请求的正常答案为合成内容，保留现场的协议结构。动态响应 token 数固定为 0，不伪造 tokenizer 统计；默认等待 250ms 后发头、每 50ms 发一个 SSE 事件，可用 `--first-byte-ms` / `--chunk-ms` 调整。不会复制现场固定 marker 当作新工具的结果。

### replay：逐字节回放现场响应

```bash
python3 distributions/mock/kiBuddyZxjtServer.py --scenario replay --case auth-bearer_only
```

客户端配置的 URL 不变。该模式始终返回选中的响应，独立于请求凭据、模型和提示词，适合复现 SDK 错误处理。请求仍需是有 Content-Length 的合法 JSON 对象。

`--case` 可选全部 21 项原始用例；完整列表见 `--help`。例如：

| case                                        | 用途                                |
| ------------------------------------------- | ----------------------------------- |
| baseline-json / baseline-stream             | 普通响应、SSE 可选空格和结束事件    |
| auth-bearer_only                            | HTTP 202 业务错误及不必要的重试     |
| auth-omit_appId / auth-omit_secretKey       | 身份验证失败的文本 SSE              |
| tool-json / tool-stream                     | 现场原生工具调用形态                |
| tool-json-roundtrip / tool-stream-roundtrip | 工具后正文、孤立 `</think>` 的处理  |
| parameter-tool-choice-named                 | 参数错误文本 SSE                    |
| error-unknown-model                         | 模型名错误、stream=false 仍返回 SSE |

`kiBuddyZxjtCapture.json` 保存原始 body、HTTP 状态、Content-Type、headers_ms、逐次读取时间与字节偏移；启动时校验 body SHA-256。默认 `--time-scale 1` 按采集读取时序安排发送，`--time-scale 0` 立即回放。它模拟的是采集器可见的相对时序，不是客户 TCP packet 边界、真实 token 时间或负载性能。HTTP Server/Date 等运行时响应头不复刻。

原始 ZIP SHA-256：`0c6af895c89e2d64f07b2ba19e667fa254d4259e761237d7c069b0cdc5a9fe7e`。仅保存测试响应与必要元数据，没有保存请求正文、请求头值、机器路径或客户内网 IP；测试模型名及接口路径保留以供真实配置验证。

## 真实工具往返

默认向声明了 `get_weather` 的客户端返回 `get_weather(city=Beijing)`。工具执行属于客户端；服务核对 assistant 调用 ID 和后续 `role: tool` 的 `tool_call_id`，拒绝不匹配、重复或缺少的结果。返回包含实际工具结果的正文，并保留现场孤立 `</think>`，供显示与历史消息验证。收到新 user 消息后开始新一轮，不复用上一轮结果。

合成模式下，`tool_choice="none"` 禁止产生工具调用；与 `ZXJT_MOCK_TOOL` 指令同时使用返回 HTTP 400。该选项没有现场采样，仅用于验证客户端禁用工具的行为。

Ki-Core 有其他工具时，在聊天输入中单独放置一行控制指令：

```text
ZXJT_MOCK_TOOL {"name":"Read","arguments":{"file_path":"/实际存在的测试目录/mock.txt"}}
```

名称、参数必须按当前 Core 实际声明填写；上面是形式示例，不保证所有版本都使用相同工具签名。服务只会返回客户端 `tools` 中实际声明的名称；参数由测试人员给定，工具 schema 与权限校验仍由 Core 执行。请选无副作用的读取工具和自己创建的测试文件。

验收时给文件写入唯一内容，通过 KiBuddy 发起调用，检查 Core 实际读取并把该内容回传；后续回答应包含真实文件内容。`/__mock/requests` 中应依次出现 `responseKind=tool`、`responseKind=tool-reply`。服务不伪造文件读取，也不会仅看到上一轮历史工具消息就认定新一轮完成。

## 合成故障

重启服务，保持同一地址，使用 `--scenario` 选择：

| scenario            | 行为                                                       |
| ------------------- | ---------------------------------------------------------- |
| headers-timeout     | 发头前等待额外 `--stall-ms`，默认 60000ms                  |
| idle-timeout        | 发出首个 SSE 事件后等待额外 stall-ms                       |
| truncated           | 发送部分 SSE，关闭连接且不发送完整 HTTP chunk 结束符       |
| missing-done        | 保留 finish_reason 和 usage，但省略 `[DONE]`；不等同于截断 |
| ignore-stream       | stream=true 请求返回 JSON                                  |
| http-429 / http-500 | 确定性 HTTP 失败，观察客户端重试次数                       |

上述故障在鉴权及模型检查通过后生效。`idle-timeout`、`truncated`、`missing-done` 用于 stream=true；没有现场对应采样，不应写成客户已出现的行为。取消请求会终止等待与发送。代理要求仍需独立代理环境验证，mock 不声称复刻客户网络。

## 观察与自动验证

- `GET /__mock/health`：当前场景、路径、模型、来源摘要。
- `GET /__mock/requests`：总请求数与最近 200 条已结束请求的元数据。可以检查三头匹配、Bearer 是否存在、stream/options、响应类型、发送字节数、结束或取消、耗时。
- `--record <path>`：将相同元数据追加为 JSONL；不记录凭据、提示词、工具参数、工具结果或原始请求 URL。父目录须存在。
- 模型发现路径返回 404 并记录一次 GET；管理接口本身不计入模型请求数。

```bash
python3 tests/unit/build-scripts/kiBuddyZxjtMockTest.py
bunx vitest run tests/unit/build-scripts/kiBuddyZxjtMock.test.ts
```

测试通过真实本地 HTTP 验证 21 项回放、鉴权、动态工具往返、错误 ID、SSE 及时到达、超时/截断、请求记录不泄漏内容。Vitest 使用 `PYTHON` 环境变量指定解释器，默认 macOS/Linux 为 python3、Windows 为 python。

服务是现场已观察协议的回放与确定性测试替身，无法从有限日志还原模型推理能力、全部请求参数语义、图片/并行工具能力、生产限流或负载。新增正文与故障始终标为 synthetic；不能用 mock 通过替代正式 Windows 包和客户现场验收。
