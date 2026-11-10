# 从 GitHub 部署 Coco 聊天 Worker

本目录是完整的中转站。Cloudflare 从 GitHub 拉取这里的代码，桌宠用户无需持有 Gemini Key。公开仓库不包含有效凭据。无需部署 GitHub Actions，也不要把 Gemini Key 写入网页或构建产物。

1. 在 **Cloudflare Dashboard → Workers & Pages** 创建 **Worker**，选择连接 GitHub，授权读取 `BangyanXia/coco-releases`，选择该仓库。若已有同名 Worker，可在它的 **Settings → Builds** 连接仓库。
2. 使用以下设置。根目录很重要：仓库首页并不是 Worker 工程。

   | 字段 | 值 |
   | --- | --- |
   | Worker 名称 | `coco-chat`（与 wrangler.jsonc 一致） |
   | Production branch | `main` |
   | Root directory | `relay` |
   | Build command | `npm test` |
   | Deploy command | `npm run deploy` |
   | Node.js | 24（已提供 .node-version） |

   保留自动安装依赖。配置已声明 SQLite Durable Object 类 `Quota`、绑定 `QUOTA` 及首次迁移。部署后记下 Cloudflare 分配的实际 HTTPS 地址。
3. 在你自己的电脑生成每位受邀者的独立访问码。安装 Node.js 24 后，从仓库根目录执行 `node relay/new-code.mjs`，不需要安装依赖。第一行是私下发给该用户的访问码；第二行是摘要。不要在 CI 中生成，不要把输出发到 issue。
4. 在 Worker 的 **Settings → Variables and Secrets** 设置以下两个**运行时 Secret**，保存并部署生效。不要填在 Builds 的构建变量里。

   | Secret | 值 |
   | --- | --- |
   | `GEMINI_API_KEY` | 你新生成的 Gemini 密钥 |
   | `COCO_CODE_HASHES` | 所有有效访问码的 SHA-256 摘要，以逗号或空白分隔；不填写访问码原文 |

   撤销某人时，删除其摘要并保留其他人的摘要。没有配置好 Secrets 时，接口返回 503，不向 Gemini 转发。不能用浏览器打开首页来判断聊天是否正常；Worker 只接受带有效访问码的 `POST /v1/chat/completions`。
5. 将 Worker 的实际域名加上 `/v1/chat/completions`，交给 Coco 客户端管理员。**现有 Windows 4.1 预览安装无需重打包**：在 Coco 安装目录的 `resources` 下新建 UTF-8 的 `coco-relay.json`，内容如下（替换为实际地址），从托盘完全退出并重启：

   ```json
   {"endpoint":"https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/v1/chat/completions"}
   ```

   这个文件只保存公开地址。打开 Coco，发送自由聊天消息，在弹窗中输入个人访问码。心情和专注查询在桌宠本机回答，不能用来检验联网。轮换 Gemini Key 不需要重新分发客户端。

## 本地验证

在本目录执行 `npm ci`、`npm test`、`node runtime-check.mjs`、`npm run check`。这几项不需要 Gemini Key：先验证鉴权与代理，再用本机 workerd 和 SQLite Durable Object 验证并发配额，最后用 Wrangler 执行部署干跑。真正部署请使用上面的 Git 集成。

## 服务行为

上游限定 Gemini，模型固定为 `gemini-flash-lite-latest`；不透传客户端指定的上游、模型、工具或头部。每人最多 4 次/滚动分钟、40 次/滚动 24 小时；全站最多 12 次/滚动分钟、400 次/滚动 24 小时。每次上游请求先预留额度，失败不自动补发。配额只覆盖本中转站，不代表 Google 项目余额。Worker 不记录消息正文或密钥；限额存储仅含时间和访问码摘要。

Cloudflare 官方参考：[Workers Builds Git 集成](https://developers.cloudflare.com/workers/ci-cd/builds/)、[构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[运行时 Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
