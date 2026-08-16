# 平台手工验收清单（M2b）

> 前提：`npm run build` 通过；DSH 侧（mock 或真实 dsh + gateway-core）已在跑。
> 启动 gateway：`GATEWAY_ADAPTERS=<ids> ... node packages/gateway/dist/index.js`

## Telegram（最易验证，推荐先做）

1. 在 @BotFather 创建 bot，拿 token：`TELEGRAM_BOT_TOKEN=<token>`
2. 启动：
   ```powershell
   $env:GATEWAY_ADAPTERS='telegram'
   $env:TELEGRAM_BOT_TOKEN='<token>'
   $env:ALLOWLIST='telegram:<你的chatId>:<你的userId>'
   node packages/gateway/dist/index.js
   ```
   （chatId/userId 可在 bot 收到消息后查看日志或先用空白名单试一次）
3. 给自己 bot 发 "你好"，确认收到 agent 回复
4. 触发审批：发一条含 "dangerous" 的消息（mock 会触发），确认收到【同意/拒绝】inline 按钮，点击后收到执行/拒绝结果

## WhatsApp

1. ```powershell
   $env:GATEWAY_ADAPTERS='whatsapp'
   $env:WHATSAPP_DATA_DIR='data/whatsapp'
   node packages/gateway/dist/index.js
   ```
2. 启动后终端出现二维码，用 WhatsApp「设置 → 已连接设备 → 扫描」完成配对
3. 给自己的号码发 "你好"；`ALLOWLIST='whatsapp:<你的JID>:<你的JID>'`（JID 形如 `60123@s.whatsapp.net`）
4. 审批：发 "dangerous xxx"，确认收到编号选项，回复 "1"/"2" 验证
5. 重启 gateway 后应免重新扫码（auth 目录持久化）

## Discord

1. Developer Portal 建应用 → Bot → 拿 token；勾选 Message Content Intent
2. ```powershell
   $env:GATEWAY_ADAPTERS='discord'
   $env:DISCORD_BOT_TOKEN='<token>'
   node packages/gateway/dist/index.js
   ```
3. 私信 bot 或把 bot 拉进服务器发消息；`ALLOWLIST='discord:<频道ID>:<用户ID>'`
4. 审批按钮：点击【同意/拒绝】验证

## Slack

1. api.slack.com 建 App → 开启 Socket Mode（拿 app-token `xapp-...`）→ OAuth 安装（拿 bot-token `xoxb-...`），订阅 `message.channels` / `message.im`
2. ```powershell
   $env:GATEWAY_ADAPTERS='slack'
   $env:SLACK_BOT_TOKEN='xoxb-...'
   $env:SLACK_APP_TOKEN='xapp-...'
   node packages/gateway/dist/index.js
   ```
3. 私信 bot；`ALLOWLIST='slack:<频道ID>:<用户ID>'`
4. 审批按钮：点击验证

## 通用检查（M2b/M3 平台通用）

- [ ] 普通消息往返（平台 → agent → 平台）
- [ ] 审批按钮/编号回复往返
- [ ] 白名单外用户收到 ⛔
- [ ] 重启 gateway 后 WhatsApp 免重新扫码（auth 目录持久化）
- [ ] 多适配器并发：`GATEWAY_ADAPTERS='cli,telegram'` 同时可用

## M4 爆款特性验收（每平台通用）

- [ ] `/help` 显示命令列表
- [ ] `/task 写一句话总结` 派生子任务并收到回执
- [ ] `/cron 0 9 * * * 每日摘要` 注册成功（gateway-core 日志显示调度已装）
- [ ] `/trace` 显示最近一轮轨迹摘要
- [ ] `/new` 重置会话
- [ ] 图片消息：发一张图，agent 有响应或明确降级提示
- [ ] 语音消息：收到明确降级提示
- [ ] （WhatsApp）审批出现**原生交互按钮**，点击直接生效

---

# 中文平台手工验收清单（M3）

> 前提同 M2b；启动 gateway：`GATEWAY_ADAPTERS=<ids> ... node packages/gateway/dist/index.js`

## 飞书

1. open.feishu.cn 建企业自建应用 → 凭据（App ID / App Secret）；开启「机器人」能力；事件订阅选「接收消息 im.message.receive_v1」（长连接模式）
2. ```powershell
   $env:GATEWAY_ADAPTERS='feishu'
   $env:FEISHU_APP_ID='cli_xxx'
   $env:FEISHU_APP_SECRET='secret'
   node packages/gateway/dist/index.js
   ```
3. 给机器人发私聊 "你好"；`ALLOWLIST='feishu:<chat_id>:<open_id>'`（日志可查）
4. 审批：发 "dangerous xxx"，确认编号选项，回复 "1"/"2"

## 钉钉

1. open.dingtalk.com 建企业内部应用 → 消息推送 → 开启机器人能力，消息接收模式选 **Stream 模式** → Client ID（AppKey）/ Client Secret（AppSecret）
2. ```powershell
   $env:GATEWAY_ADAPTERS='dingtalk'
   $env:DINGTALK_CLIENT_ID='<clientId>'
   $env:DINGTALK_CLIENT_SECRET='<clientSecret>'
   node packages/gateway/dist/index.js
   ```
3. 给机器人发 "你好"；审批：发 "dangerous xxx" 回复 "1"/"2"

## 企业微信（需公网回调地址）

1. work.weixin.qq.com 自建应用 → 接收消息：设置 URL（指向 gateway 的 `WECOM_CALLBACK_PORT`，默认 3193）、Token、EncodingAESKey（43 位）
2. ```powershell
   $env:GATEWAY_ADAPTERS='wecom'
   $env:WECOM_CORP_ID='wwxxx'; $env:WECOM_SECRET='xxx'; $env:WECOM_AGENT_ID='1000002'
   $env:WECOM_TOKEN='<token>'; $env:WECOM_ENCODING_AES_KEY='<43位>'
   node packages/gateway/dist/index.js
   ```
3. 用应用可见范围内成员给应用发消息验证
4. 无公网时用内网穿透（frp/ngrok/cloudflared）把 3193 映射出去；部署到 VPS 时直接可用
