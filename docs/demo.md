# 演示脚本（dsh-overdrive 爆款 demo）

> 目标观众：开发者。时长约 3 分钟。录屏建议 4K 60fps，配乐轻快。

## 0. 准备（5 分钟，不在镜头内）

1. VPS（或本机 Docker）：`docker compose -f deploy/docker-compose.yml up -d`
2. `.env` 配置 `DEEPSEEK_API_KEY`、`GATEWAY_ADAPTERS=telegram,whatsapp`、`TELEGRAM_BOT_TOKEN`
3. 打开 `http://<host>:3190/` 确认控制台显示 DSH ok、telegram 已连接
4. WhatsApp 已扫码配对（auth 目录持久化）

## 1. 开场（10s）

> "我们把 DeepSeek Harness 装进了聊天软件——WhatsApp 扫个码，它就是你的私人 agent。"

## 2. 普通对话（30s）

- Telegram 发："帮我分析这个仓库的架构"（贴 README 链接）
- 展示：🧠/🛠️ 轨迹行 → 最终答案
- 画外音："它每步都看得到——工具调用、思考，全程可追踪。"

## 3. 轨迹（20s）

- 发 `/trace` → 展示轨迹摘要卡片
- 画外音："这不是黑盒——每一步都能回放。"

## 4. 子任务（20s）

- 发 `/task 写 3 个营销 slogan`
- 展示回执 + 结果
- 画外音："你可以派它并行干活。"

## 5. 定时任务（20s）

- 发 `/cron 0 9 * * * 每天早上给我一条行业新闻摘要`
- 展示注册回执；演示时可把分钟调近以现场触发
- 画外音："它会自己干活，到点汇报。"

## 6. 审批（20s）

- 发一条**真正触发工具调用的需求**：`帮我用 bash 看看当前目录`
- DSH 安全沙箱弹出审批 → Telegram 出现【同意/拒绝】inline 按钮 → 点击"拒绝"
- 画外音："危险操作永远要你点头。"
- **真机经验（2026-08-16）**：真实 DSH 里 "dangerous" 不是触发词——审批只在 agent 真实调用需批准的工具（bash/fs 等）时触发；文案不要包含"发"字以免被当作消息内容。

## 7. 收尾（10s）

> "一条命令部署、扫码即用、全程可追踪——dsh-overdrive。链接在下方。"

## 素材

- 控制台截图、WhatsApp 原生按钮截图、轨迹摘要截图
- 终端录像（asciinema）录 VPS 侧 `docker compose up -d` 到控制台可见

## 常见翻车点

- WhatsApp 扫码超时：提前配对并保持登录态
- 模型未配置：提前在 DSH Web UI（3080）配好 API key
- 审批按钮无响应：确认 gateway 与插件版本匹配（原生按钮需 M4 之后构建）
